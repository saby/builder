/* eslint-disable no-unused-expressions */
'use strict';

require('../../lib/logger').setGulpLogger('warning');

const { expect } = require('chai');
const { parse, Syntax } = require('esprima-next');

const {
   isPrivate,
   sortPrivateModulesByDependencies,
   getLibraryMeta,
   readModuleAndGetParamsNames

   // TODO: Add tests for following functions
   //  addExternalDepsToLibrary,
   //  deletePrivateDepsFromList
} = require('../../lib/pack/helpers/librarypack');

const size = obj => Object.keys(obj || {}).length;

function createDefineModule(cfg) {
   let {
      libraryDependencies,
      libraryParametersNames,
      libraryBody
   } = cfg;

   libraryDependencies = libraryDependencies || [];
   libraryParametersNames = libraryParametersNames || [];
   libraryBody = libraryBody || '';

   const defineParams = [
      JSON.stringify(cfg.libraryName),
      JSON.stringify(libraryDependencies),
      `function(${libraryParametersNames.join(',')}){${libraryBody}}`
   ];

   return `define(${defineParams.join(',')});`;
}

// TODO: Check stress situations
describe('Library packing', () => {
   describe('Pack helpers', () => {
      describe('isPrivate()', () => {
         it('Should be private module', () => {
            const modulePaths = [
               'A/b/_c/d.js',
               'A/_b/c/d.js',
               '_A/_b/_c/_d.js'
            ];

            for (const modulePath of modulePaths) {
               expect(isPrivate(modulePath)).to.be.true;
            }
         });
         it('Should not be private module', () => {
            const modulePaths = [
               'A/b/c/d.js',
               '_A/b/c/d.js',
               'A/b/c/_d.js'
            ];

            for (const modulePath of modulePaths) {
               expect(isPrivate(modulePath)).to.be.false;
            }
         });
      });
      describe('sortPrivateModulesByDependencies()', () => {
         it('Should order chain dependencies', () => {
            const modules = [{
               moduleName: 'A/_b/c',
               dependencies: ['A/_b/e'],
               expectedDepth: 2,
               depth: -1
            }, {
               moduleName: 'A/_b/d',
               dependencies: [],
               expectedDepth: 0,
               depth: -1
            }, {
               moduleName: 'A/_b/e',
               dependencies: ['A/_b/d'],
               expectedDepth: 1,
               depth: -1
            }];

            const orderedModules = sortPrivateModulesByDependencies(modules);

            orderedModules.forEach(module => expect(module.depth).equal(module.expectedDepth));
         });
         it('Should order tree dependencies', () => {
            const modules = [{
               moduleName: 'A/_b/c',
               dependencies: ['A/_b/e'],
               expectedDepth: 1,
               depth: -1
            }, {
               moduleName: 'A/_b/d',
               dependencies: ['A/_b/e'],
               expectedDepth: 1,
               depth: -1
            }, {
               moduleName: 'A/_b/e',
               dependencies: [],
               expectedDepth: 0,
               depth: -1
            }];

            const orderedModules = sortPrivateModulesByDependencies(modules);

            orderedModules.forEach(module => expect(module.depth).equal(module.expectedDepth));
         });
      });
      describe('getLibraryMeta()', () => {
         it('Should collect library names', () => {
            const cfg = {
               libraryName: 'A/_b/c',
               libraryDependencies: ['A/_b/d', 'A/_b/e'],
               libraryParametersNames: ['d', 'e'],
               libraryBody: ''
            };
            const librarySource = createDefineModule(cfg);
            const ast = parse(librarySource);
            const result = getLibraryMeta(ast);

            expect(result.libraryName).to.equal(cfg.libraryName);

            expect(result.libraryDependencies.every((literal, index) => (
               literal.type === Syntax.Literal &&
               literal.value === cfg.libraryDependencies[index]
            ))).to.be.true;

            expect(result.libraryParametersNames.every((identifier, index) => (
               identifier.type === Syntax.Identifier &&
               identifier.name === cfg.libraryParametersNames[index]
            ))).to.be.true;
         });
         it('Should match dependency name and its identifier', () => {
            const cfg = {
               libraryName: 'A/_b/c',
               libraryDependencies: ['A/d', 'A/_b/e', 'B/c', 'A/_b/f'],
               libraryParametersNames: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
               libraryBody: ''
            };
            const librarySource = createDefineModule(cfg);
            const ast = parse(librarySource);
            const result = getLibraryMeta(ast);

            expect(result.libraryParametersNames.every((identifier, index) => (
               identifier.type === Syntax.Identifier &&
               identifier.name === cfg.libraryParametersNames[index]
            ))).to.be.true;

            expect(size(result.libraryDependencies)).to.equal(cfg.libraryDependencies.length);

            cfg.libraryDependencies.forEach((dependencyName, index) => {
               const actualNames = result.libraryDependenciesMeta[dependencyName].names;
               const expectedNames = [cfg.libraryParametersNames[index]];

               expect(actualNames).to.deep.equal(expectedNames);
            });
         });
         it('Should detect TS exports node', () => {
            const cfg = {
               libraryName: 'A/_b/c',
               libraryDependencies: ['A/_b/d', 'A/_b/e'],
               libraryParametersNames: ['d', 'e'],
               libraryBody: `
                  Object.defineProperty(exports, "__esModule", { value: true });
                  exports.exportedFunction = void 0;
                  function exportedFunction() {
                     return 'Example';
                  }
                  exports.exportedFunction = exportedFunction;
               `
            };
            const librarySource = createDefineModule(cfg);
            const ast = parse(librarySource);
            const result = getLibraryMeta(ast);

            // The number of node in functionCallbackBody which contains following code:
            // Object.defineProperty(exports, "__esModule", { value: true });
            expect(result.exportsDefine.position).to.equal(0);
         });
         it('Should detect return statement from module', () => {
            const cfg = {
               libraryName: 'A/_b/c',
               libraryDependencies: ['A/_b/d', 'A/_b/e'],
               libraryParametersNames: ['d', 'e'],
               libraryBody: 'return { magicNumner: 123.456 };'
            };
            const librarySource = createDefineModule(cfg);
            const ast = parse(librarySource);
            const result = getLibraryMeta(ast);

            expect(result.topLevelReturnStatement.statement.type).to.equal(Syntax.ReturnStatement);
            expect(result.topLevelReturnStatement.returnsType).to.equal(Syntax.ObjectExpression);
         });
      });
      describe('readModuleAndGetParamsNames()', () => {
         it('Should process define with exact module name', async() => {
            const cache = { };

            function createAndCache(cfg) {
               cache[cfg.libraryName] = {
                  nodeName: cfg.libraryName,
                  text: createDefineModule(cfg)
               };
            }

            createAndCache({
               libraryName: 'wml!A/_b/c',
               libraryDependencies: ['G/h']
            });
            createAndCache({
               libraryName: 'A/_b/c/d',
               libraryDependencies: ['I/j']
            });
            createAndCache({
               libraryName: 'A/_b/c',
               libraryDependencies: ['K/m']
            });

            const result = await readModuleAndGetParamsNames(
               '/dir/source',
               '/dir/output',
               'A/_b/c',
               'A/_b/c',
               [],
               [],
               cache
            );

            expect(result.moduleName).to.equal('A/_b/c');
            expect(result.dependencies).to.deep.equal(['K/m']);
         });
      });
   });
});
