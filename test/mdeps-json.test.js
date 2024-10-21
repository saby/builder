/* eslint-disable no-unused-expressions */
'use strict';

require('../lib/logger').setGulpLogger('warning');

const { expect } = require('chai');
const { path } = require('../lib/platform/path');

const { DependencyController } = require('../gulp/builder/plugins/create-module-dependencies-json');
const ModuleInfo = require('../gulp/builder/classes/module-info');
const ModuleCache = require('../gulp/builder/classes/modules-cache');
const Cache = require('../gulp/builder/classes/cache');

function slice(array, from, to = Number.MAX_SAFE_INTEGER) {
   return array.reduce((arr, elem, idx) => ((idx >= from && idx < to) ? [...arr, elem] : arr), []);
}

function createModuleInfo(moduleName) {
   const moduleInfo = new ModuleInfo(
      {
         name: moduleName,
         responsible: 'responsible',
         required: '0',
         rebuild: false,
         depends: [],
         changedFiles: [],
         deletedFiles: [],
         featuresRequired: [],
         featuresProvided: [],
         description: 'description',
         path: `/input/${moduleName}`
      },
      null,
      { output: '/output/' },
      false
   );

   moduleInfo.cache = new ModuleCache();

   return moduleInfo;
}

function createConfig(moduleName) {
   return {
      branchTests: true,
      suffix: '',
      resourcesUrl: '/',
      moduleInfo: createModuleInfo(moduleName)
   };
}

describe('gulp/builder/plugins/create-module-dependencies-json', () => {
   describe('storeNode()', () => {
      let config;
      let controller;

      beforeEach(() => {
         config = createConfig('UIModule');
         controller = new DependencyController(config);
      });
      it('should add new node', () => {
         const nodeName = `${config.moduleInfo.name}/Component`;
         const relPath = `${nodeName}.js`;
         const value = { ok: true };

         controller.storeNode(nodeName, value, relPath);

         const { nodes } = controller.data;

         expect(nodes).to.haveOwnProperty(nodeName);
         expect(nodes[nodeName].ok).to.be.true;
         expect(nodes[nodeName].path).to.equal(path.join('resources', relPath));
      });
      it('should replace existing node and the same path', () => {
         const nodeName = `${config.moduleInfo.name}/Component`;
         const relPath = `${nodeName}.js`;
         const value = { ok: true };

         controller.storeNode(nodeName, value, relPath);
         controller.storeNode(nodeName, { ok: false }, relPath);

         const { nodes } = controller.data;

         expect(nodes).to.haveOwnProperty(nodeName);
         expect(nodes[nodeName].ok).to.be.true;
         expect(nodes[nodeName].path).to.equal(path.join('resources', relPath));
      });
      it('should replace existing node and different path', () => {
         const nodeName = `${config.moduleInfo.name}/dir/Component`;
         const relPath = `${nodeName}.js`;
         const value = { ok: true };

         controller.storeNode(nodeName, value, relPath);
         controller.storeNode(nodeName, { ok: false }, `${config.moduleInfo.name}/Component.js`);

         const { nodes } = controller.data;

         expect(nodes).to.haveOwnProperty(nodeName);
         expect(nodes[nodeName].ok).to.be.true;
         expect(nodes[nodeName].path).to.equal(path.join('resources', relPath));
      });
      it('should replace existing node and different path 2', () => {
         const nodeName = `${config.moduleInfo.name}/dir/Component`;
         const relPath = `${nodeName}.js`;
         const value = { ok: true };

         controller.storeNode(nodeName, value, `${config.moduleInfo.name}/Component.js`);
         controller.storeNode(nodeName, { ok: false }, relPath);

         const { nodes } = controller.data;

         expect(nodes).to.haveOwnProperty(nodeName);
         expect(nodes[nodeName].ok).to.be.true;
         expect(nodes[nodeName].path).to.equal(path.join('resources', relPath));
      });
      it('should save substitution', () => {
         config = createConfig('WS.Core');
         controller = new DependencyController(config);

         const nodeName = `${config.moduleInfo.name}/Component`;
         const relPath = `${nodeName}.js`;
         const value = { ok: true };

         controller.storeNode(nodeName, value, relPath);
         controller.storeNode(nodeName, { ok: false }, relPath);

         const { nodes, requireJsSubstitutions } = controller.data;

         expect(nodes).to.haveOwnProperty(nodeName);
         expect(nodes[nodeName].ok).to.be.true;
         expect(nodes[nodeName].path).to.equal(path.join('resources', relPath));

         expect(requireJsSubstitutions).to.haveOwnProperty(nodeName);
         expect(requireJsSubstitutions[nodeName]).to.equal(relPath);
      });
   });
   describe('addComponentsInfo()', () => {
      let cache;
      let config;
      let controller;

      beforeEach(() => {
         cache = new Cache({
            rawConfig: { }
         });
         config = createConfig('UIModule');
         controller = new DependencyController(config);
      });

      it('should store component node', () => {
         const componentName = 'UIModule/component';
         const relPath = `${componentName}.js`;
         const componentsInfo = {
            [relPath]: {
               componentName,
               componentDep: []
            }
         };

         controller.addComponentsInfo(componentsInfo, cache);

         const { nodes } = controller.data;

         expect(nodes).to.haveOwnProperty(componentName);
         expect(nodes[componentName].amd).to.be.true;
         expect(nodes[componentName].path).to.equal(path.join('resources', relPath));
      });
      it('should store component dependencies', () => {
         const componentName = 'UIModule/component';
         const relPath = `${componentName}.js`;
         const componentsInfo = {
            [relPath]: {
               componentName,
               componentDep: [
                  'wml!UIModule/template',
                  'unknown!UIModule/file',
                  'cdn!UIModule/anotherFile',
                  'UIModule/someComponent',
                  'require'
               ]
            }
         };

         controller.addComponentsInfo(componentsInfo, cache);

         const { links } = controller.data;

         expect(links).hasOwnProperty(componentName);
         expect(links[componentName]).deep.equal([
            'wml',
            'wml!UIModule/template',
            'unknown!UIModule/file',
            'cdn',
            'UIModule/someComponent'
         ]);
      });
      it('should process library', () => {
         const componentName = 'UIModule/component';
         const relPath = `${componentName}.js`;
         const libraryName = 'firstLibrary';
         const componentsInfo = {
            [relPath]: {
               libraryName,
               packedModules: [
                  'wml!UIModule/_component/template',
                  'UIModule/first'
               ]
            }
         };

         controller.addComponentsInfo(componentsInfo, cache);

         const { packedPrivateModules } = controller;
         for (const dep of componentsInfo[relPath].packedModules) {
            expect(packedPrivateModules).haveOwnProperty(dep);
            expect(packedPrivateModules[dep]).includes(libraryName);
         }

         const { packedLibraries } = controller.data;
         expect(packedLibraries).haveOwnProperty(libraryName);
         expect(packedLibraries[libraryName]).deep.equal(componentsInfo[relPath].packedModules);
      });
      it('should process less', () => {
         const componentName = 'UIModule/component';
         const relPath = `${componentName}.js`;
         const componentsInfo = {
            [relPath]: {
               componentName,
               lessDependencies: [
                  'UIModule/styles'
               ],
            }
         };

         const rootPath = '/root/';
         const dependencies = [
            'UIModule/styles',
            'UIModule/other'
         ];

         cache.addDependencies(
            rootPath,
            path.join(rootPath, `${dependencies[0]}.less`),
            slice(dependencies, 1).map(v => `${v}.less`)
         );
         controller.addComponentsInfo(componentsInfo, cache);

         const { lessDependencies } = controller.data;
         expect(lessDependencies).haveOwnProperty(componentName);
         expect(lessDependencies[componentName]).deep.equal(dependencies.map(v => `css!${v}`));
      });
      it('should process less from theme module', () => {
         const componentName = 'UIModule/component';
         const relPath = `${componentName}.js`;
         const componentsInfo = {
            [relPath]: {
               componentName,
               lessDependencies: [
                  'UIModule-default-theme/styles'
               ],
            }
         };

         const rootPath = '/root/';
         const dependencies = [
            'UIModule-default-theme/styles',
            'UIModule-default-theme/other'
         ];

         cache.addDependencies(
            rootPath,
            path.join(rootPath, `${dependencies[0]}.less`),
            slice(dependencies, 1).map(v => `${v}.less`)
         );
         controller.addComponentsInfo(componentsInfo, cache);

         const { lessDependencies } = controller.data;
         expect(lessDependencies).haveOwnProperty(componentName);
         expect(lessDependencies[componentName]).deep.equal(dependencies.map(v => `css!${v}`));
      });
   });
   describe('addMarkupCache()', () => {
      let config;
      let controller;

      function forEachPair(map, callback) {
         for (const [plugin, ext] of map.entries()) {
            const baseName = `UIModule/${plugin}-template`;
            const relPath = `${baseName}.${ext}`;
            const nodeName = `${plugin}!${baseName}`;

            const markupCache = {
               [relPath]: {
                  nodeName,
                  dependencies: [`UIModule/component-for-${plugin}`]
               }
            };

            controller.addMarkupCache(markupCache);

            callback(nodeName, relPath, markupCache);
         }
      }

      beforeEach(() => {
         config = createConfig('UIModule');
         controller = new DependencyController(config);
      });

      it('should have template nodes', () => {
         const map = new Map([
            ['wml', 'wml'],
            ['tmpl', 'tmpl'],
            ['html', 'xhtml']
         ]);

         forEachPair(map, (nodeName, relPath) => {
            const { nodes } = controller.data;

            expect(nodes).to.haveOwnProperty(nodeName);
            expect(nodes[nodeName].amd).to.be.true;
            expect(nodes[nodeName].path).to.equal(path.join('resources', relPath));
         });
      });
      it('should have template links', () => {
         const map = new Map([
            ['wml', 'wml'],
            ['tmpl', 'tmpl']
         ]);

         forEachPair(map, (nodeName, relPath, markupCache) => {
            const { links } = controller.data;

            expect(links).to.haveOwnProperty(nodeName);
            expect(links[nodeName]).to.deep.equal(markupCache[relPath].dependencies);
         });
      });
   });
   describe('merge()', () => {
      let config;
      let controller;

      beforeEach(() => {
         config = createConfig('UIModule');
         controller = new DependencyController(config);
      });

      it('should merge links', () => {
         const components = [
            ['UIModule/1st', [], ['UIComponent/a'], true, null, ['UIComponent/a']],
            ['UIModule/2nd', ['UIComponent/b'], ['UIComponent/c'], true, null, ['UIComponent/c']],
            ['UIModule/3rd', ['UIComponent/d'], [], true, null, ['UIComponent/d']],

            ['UIModule/4th', [], ['UIComponent/e'], false, null, []],
            ['UIModule/5th', ['UIComponent/f'], ['UIComponent/g'], false, null, ['UIComponent/f']],
            ['UIModule/6th', ['UIComponent/h'], [], false, null, ['UIComponent/h']],

            ['UIModule/7th', [], ['UIComponent/i'], true, 'first', []],
            ['UIModule/8th', ['UIComponent/j'], ['UIComponent/k'], true, 'first', ['UIComponent/j']],
            ['UIModule/9th', ['UIComponent/m'], [], true, 'first', ['UIComponent/m']],

            ['UIModule/10th', [], ['UIComponent/n'], false, 'second', []],
            ['UIModule/11th', ['UIComponent/p'], ['UIComponent/q'], false, 'second', ['UIComponent/p']],
            ['UIModule/12th', ['UIComponent/r'], [], false, 'second', ['UIComponent/r']],
         ];

         const data = {
            links: {},
            packedLibraries: {},
            nodes: {}
         };
         const expectedLinks = {};

         for (const [componentName, links, contrLinks, isInContr, libName, expected] of components) {
            data.links[componentName] = [...links];

            if (isInContr) {
               controller.links[componentName] = [...contrLinks];
            }

            if (libName) {
               data.packedLibraries[componentName] = libName;
            }

            expectedLinks[componentName] = expected;
         }

         controller.merge(data);

         const { links } = controller.data;

         expect(links).to.deep.equal(expectedLinks);
      });
      it('should merge nodes', () => {
         const components = [
            ['UIModule/1st', {}, { idx: 1 }, true, false, { idx: 1 }],
            ['UIModule/2nd', { idx: 2 }, { idx: 3 }, true, false, { idx: 3 }],
            ['UIModule/3rd', { idx: 4 }, {}, true, false, {}],

            ['UIModule/4th', {}, { idx: 5 }, false, false, {}],
            ['UIModule/5th', { idx: 6 }, { idx: 7 }, false, false, { idx: 6 }],
            ['UIModule/6th', { idx: 8 }, {}, false, false, { idx: 8 }],

            ['UIModule/7th', {}, { idx: 9 }, true, true, { idx: 9 }],
            ['UIModule/8th', { idx: 10 }, { idx: 11 }, true, true, { idx: 11 }],
            ['UIModule/9th', { idx: 12 }, {}, true, true, {}],

            ['UIModule/10th', {}, { idx: 13 }, false, true, {}],
            ['UIModule/11th', { idx: 14 }, { idx: 15 }, false, true, { idx: 14 }],
            ['UIModule/12th', { idx: 16 }, {}, false, true, { idx: 16 }],
         ];

         const data = {
            links: {},
            packedLibraries: {},
            nodes: {}
         };
         const expectedNodes = {};
         const expectedPackedLibraries = {};

         for (const [componentName, obj, ctrObj, isInContr, isInLib, expectedObj] of components) {
            controller.links[componentName] = [];

            data.nodes[componentName] = obj;

            if (isInContr) {
               controller.nodes[componentName] = ctrObj;
            }

            if (isInLib) {
               expectedPackedLibraries[componentName] = 0;
               data.packedLibraries[componentName] = 0;
            }

            expectedNodes[componentName] = expectedObj;
         }

         controller.merge(data);

         const { nodes, packedLibraries } = controller.data;

         expect(nodes).to.deep.equal(expectedNodes);
         expect(packedLibraries).to.deep.equal(expectedPackedLibraries);
      });
   });
   describe('forEachIntersection()', () => {
      let cache;
      let config;
      let controller;

      beforeEach(() => {
         cache = new Cache({
            rawConfig: { }
         });
         config = createConfig('UIModule');
         controller = new DependencyController(config);
      });

      it('should have intersections', () => {
         const componentsInfo = {};
         const expectedModule = 'UIModule/A';
         const libraries = [
            ['first', [expectedModule]],
            ['second', ['UIModule/B']],
            ['third', [expectedModule]]
         ];

         for (const [libraryName, packedModules] of libraries) {
            componentsInfo[`${libraryName}.js`] = {
               libraryName,
               packedModules
            };
         }

         controller.addComponentsInfo(componentsInfo, cache);

         controller.forEachIntersection((duplicatedKey) => {
            expect(duplicatedKey).to.equal(expectedModule);
         });
      });
   });
});
