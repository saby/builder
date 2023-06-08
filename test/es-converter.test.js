/* eslint-disable no-unused-expressions */
'use strict';

require('./init-test');

const { expect } = require('chai');
const { parseCode } = require('../lib/espree/common');
const convert = require('../lib/es-converter');
const amd = require('../lib/es-converter/amd');
const umd = require('../lib/es-converter/umd-saby');

const toDefaultFactory = content => `function(require, exports, module) {
${content}
}`;

describe('lib/es-converter', () => {
   describe('parse source', () => {
      it('should parse amd 1', () => {
         const source = 'define(function(){ });';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('amd');
         expect(meta.hasError).to.be.false;
      });
      it('should parse amd 2', () => {
         const source = 'define(["dep"], function(){ });';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('amd');
         expect(meta.dependencies).deep.equal(['dep']);
         expect(meta.hasError).to.be.false;
      });
      it('should parse amd 3', () => {
         const source = 'define("name", function(){ });';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('amd');
         expect(meta.moduleName).equals('name');
         expect(meta.hasError).to.be.false;
      });
      it('should parse amd 4', () => {
         const source = 'define("name", ["dep"], function(){ });';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('amd');
         expect(meta.moduleName).equals('name');
         expect(meta.dependencies).deep.equal(['dep']);
         expect(meta.hasError).to.be.false;
      });
      it('should parse amd 5', () => {
         const source = 'define("name", ["dep"], () => {});';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('amd');
         expect(meta.moduleName).equals('name');
         expect(meta.dependencies).deep.equal(['dep']);
         expect(meta.hasError).to.be.false;
      });
      it('should parse amd 6', () => {
         const source = 'define("name", (() => ["dep"])(), () => {});';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('amd');
         expect(meta.moduleName).equals('name');
         expect(meta).hasOwnProperty('dependenciesCallback');
         expect(meta.dependenciesCallbackIndex).equals(1);
         expect(meta.hasError).to.be.false;
      });
      it('should parse amd 7', () => {
         const source = 'define((() => {})());';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('amd');
         expect(meta.hasError).to.be.false;
      });
      it('should detect amd error 1', () => {
         const source = 'define("name");';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta).to.be.undefined;
      });
      it('should detect amd error 2', () => {
         const source = 'define([], []);';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta).to.be.undefined;
      });
      it('should parse umd 1', () => {
         const source = umd.formatClassic({
            factory: 'function() {}'
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('umd');
      });
      it('should parse umd 2', () => {
         const source = umd.formatClassic({
            factory: '() => {}'
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta.originModule).equals('umd');
      });
      it('should not parse unknown module', () => {
         const source = 'console.log("hello, world!")';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {};
         const meta = convert.parse(program, options);

         expect(meta).to.be.undefined;
      });
      it('should use program as factory', () => {
         const source = 'console.log("hello, world!")';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {
            isCompiledFromTsc: true
         };
         const meta = convert.parse(program, options);

         expect(meta.originModule).to.be.undefined;
         expect(meta.factory).equals(program);
         expect(meta.hasError).to.be.undefined;
      });
      it('should use cjs program as factory', () => {
         const source = 'module.exports = function() {}';
         const program = parseCode(source, '', { ecmaVersion: 2021 });
         const options = {
            isCompiledFromTsc: true
         };
         const meta = convert.parse(program, options);

         expect(meta.originModule).to.be.undefined;
         expect(meta.factory).equals(program);
         expect(meta.hasError).to.be.undefined;
      });
   });
   describe('should insert module name', () => {
      const moduleName = 'UIModule/dir/file';
      const dependencies = ['require', 'exports', 'tslib'];
      const factoryArguments = ['global.requirejs', 'module.exports'];
      const factory = 'function(require, exports, tslib) {/*body*/}';
      const arrowFactory = '(require, exports, tslib) => {/*body*/}';

      it('anonymous amd module', async() => {
         const source = amd.format({
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, ['amd', 'umd'], {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies,
            factory
         }));
      });
      it('anonymous umd module', async() => {
         const source = umd.formatClassic({
            factoryArguments: ['require', 'exports'],
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.formatClassic({
            moduleName,
            dependencies,
            factoryArguments,
            factory
         }));
      });

      it('should correct amd module name', async() => {
         const invalidModuleName = 'UIModule/Module';
         const source = amd.format({
            moduleName: invalidModuleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies,
            factory
         }));
      });
      it('should correct umd module', async() => {
         const invalidModuleName = 'UIModule/Module';
         const source = umd.formatClassic({
            moduleName: invalidModuleName,
            factoryArguments: ['require', 'exports'],
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.formatClassic({
            moduleName,
            dependencies,
            factoryArguments,
            factory
         }));
      });

      it('arrow factory function amd module', async() => {
         const source = amd.format({
            dependencies,
            factory: arrowFactory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies,
            factory: arrowFactory
         }));
      });
      it('arrow factory function umd module', async() => {
         const source = umd.formatClassic({
            factoryArguments: ['require', 'exports'],
            dependencies,
            factory: arrowFactory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.formatClassic({
            moduleName,
            dependencies,
            factoryArguments,
            factory: arrowFactory
         }));
      });

      it('parenthesis', async() => {
         const source = '(function (factory) {\n' +
            '   if (typeof module === "object" && typeof module.exports === "object") {\n' +
            '      var v = factory(require,exports);\n' +
            '      if (v !== undefined) module.exports = v;\n' +
            '   }\n' +
            '   else if (typeof define === "function" && define.amd) {\n' +
            '      define(["require", "exports", "tslib"], factory);\n' +
            '   }\n' +
            '}(function(require, exports, tslib) {/*body*/}));';
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.formatClassic({
            moduleName,
            dependencies,
            factoryArguments,
            factory
         }));
      });
   });
   describe('should convert module', () => {
      const leadingData = (
         '/**\n' +
         ' * @jest-environment node\n' +
         ' */\n'
      );
      const trailingData = '\n//# sourceMappingURL=data:application/json;base64,eyJ2ZaW9uIjozLC==';
      const moduleName = 'UIModule/dir/file';
      const dependencies = ['require', 'exports', 'tslib'];
      const factoryArguments = ['global.requirejs', 'module.exports', 'global.requirejs("tslib")'];
      const factory = 'function(require, exports, tslib) {/*body*/}';

      const toSource = content => (leadingData + content + trailingData);

      it('from amd to amd', async() => {
         const source = toSource(amd.format({
            moduleName,
            dependencies,
            factory
         }));
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(toSource(amd.format({
            moduleName,
            dependencies,
            factory
         })));
      });
      it('from amd to umd', async() => {
         const source = toSource(amd.format({
            moduleName,
            dependencies,
            factory
         }));
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(toSource(umd.format({
            moduleName,
            dependencies,
            factoryArguments,
            factory
         })));
      });
      it('from umd to amd', async() => {
         const source = toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factory,
            factoryArguments: ['require', 'exports']
         }));
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(toSource(amd.format({
            moduleName,
            dependencies,
            factory
         })));
      });
      it('from umd to umd', async() => {
         const source = toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factory,
            factoryArguments: ['require', 'exports']
         }));
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factoryArguments: ['global.requirejs', 'module.exports'],
            factory
         })));
      });
      it('to umd with keepSourceMap', async() => {
         const source = toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factory,
            factoryArguments: ['require', 'exports']
         }));
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true,
            keepSourceMap: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factoryArguments: ['global.requirejs', 'module.exports'],
            factory
         })));
      });
   });
   describe('should normalize dependencies', () => {
      const reqDeps = deps => deps.map((d, i) => `const d_${i} = require("${d}");`).join('');
      const toFactory = deps => `function(){${reqDeps(deps)}}`;

      const moduleName = 'UIModule/dir/file';
      const dependencies = ['./file1', '../file2'];
      const resolvedDependencies = ['UIModule/dir/file1', 'UIModule/file2'];

      const factory = toFactory(dependencies);
      const resolvedFactory = toFactory(resolvedDependencies);

      it('for amd module', async() => {
         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies: resolvedDependencies,
            factory: resolvedFactory
         }));
      });
      it('for amd module with no require in body', async() => {
         const source = amd.format({
            moduleName,
            dependencies,
            factory: toFactory([])
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies: resolvedDependencies,
            factory: toFactory([])
         }));
      });
      it('for umd module', async() => {
         const source = umd.formatClassic({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.formatClassic({
            moduleName,
            dependencies: resolvedDependencies,
            factory: resolvedFactory
         }));
      });
   });
   describe('should normalize r.js dependencies', () => {
      const interfaceModule = 'UIModule';
      const factory = 'function(require, exports) {/*body*/}';

      it('should have no changes', async() => {
         const moduleName = `${interfaceModule}/dir/moduleName`;
         const dependencies = [
            `js!${interfaceModule}/dir/first`,
            `tmpl!${interfaceModule}/second`,
            `css!${interfaceModule}/third.css`
         ];

         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            dependencies,
            factory
         }));
      });
      it('should resolve relative dependencies', async() => {
         const moduleName = `${interfaceModule}/dir1/dir2/moduleName`;
         const dependencies = [
            '../../first',
            '../second',
            './third'
         ];

         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         const expectedDependencies = [
            'UIModule/first',
            'UIModule/dir1/second',
            'UIModule/dir1/dir2/third'
         ];
         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            dependencies: expectedDependencies,
            factory
         }));
      });
      it('should resolve dependencies with ext', async() => {
         const moduleName = `${interfaceModule}/dir1/dir2/moduleName`;
         const dependencies = [
            '../../first',
            '../second',
            './third'
         ];

         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         const expectedDependencies = [
            'UIModule/first',
            'UIModule/dir1/second',
            'UIModule/dir1/dir2/third'
         ];
         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            dependencies: expectedDependencies,
            factory
         }));
      });
      it('should substitute deprecated names', async() => {
         const moduleName = 'WS.Core/lib/dir/module';
         const dependencies = [
            'WS.Core/css/file',
            'WS.Core/core/module'
         ];

         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         const expectedModuleName = 'Lib/dir/module';
         const expectedDependencies = [
            'WS/css/file',
            'Core/module'
         ];
         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName: expectedModuleName,
            dependencies: expectedDependencies,
            factory
         }));
      });
   });
   describe('should normalize WS.Core paths', () => {
      const reqDeps = deps => deps.map((d, i) => `const d_${i} = require("${d}");`).join('');
      const toFactory = deps => `function(){${reqDeps(deps)}}`;

      const filePath = 'WS.Core/core/dir/file.tsx';
      const moduleName = 'Core/dir/file';
      const dependencies = ['./file1', '../file2'];
      const resolvedDependencies = ['Core/dir/file1', 'Core/file2'];

      const factory = toFactory(dependencies);
      const resolvedFactory = toFactory(resolvedDependencies);

      it('for amd module', async() => {
         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies: resolvedDependencies,
            factory: resolvedFactory
         }));
      });
      it('for umd module', async() => {
         const source = umd.formatClassic({
            moduleName,
            dependencies,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.formatClassic({
            moduleName,
            dependencies: resolvedDependencies,
            factory: resolvedFactory
         }));
      });
   });
   describe('should process dynamic dependencies', () => {
      const moduleName = 'UIModule/dir/file';
      const dependenciesCall = '(function() { return ["d1", "d2"]; })()';
      const arrowDependenciesCall = '(() => { return ["d1", "d2"]; })()';
      const factoryArguments = ['global.requirejs("UIModule/dir/file1")', 'global.requirejs("UIModule/file2")'];

      const factory = 'function(){/*body*/}';
      const arrowFactory = '(require, exports) => {/*body*/}';

      it('for amd module', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependenciesCall,
            factory
         }));
      });
      it('for umd module', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            factoryArguments,
            dependenciesCall,
            factory
         }));
      });

      it('for amd module with arrow deps function', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall: arrowDependenciesCall,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependenciesCall: arrowDependenciesCall,
            factory
         }));
      });
      it('for umd module with arrow deps function', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall: arrowDependenciesCall,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            factoryArguments,
            dependenciesCall: arrowDependenciesCall,
            factory
         }));
      });

      it('for amd module with callback factory', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependenciesCall,
            factory
         }));
      });
      it('for umd module with callback factory', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            factoryArguments,
            dependenciesCall,
            factory
         }));
      });

      it('for amd module with arrow callback factory', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory: arrowFactory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependenciesCall,
            factory: arrowFactory
         }));
      });
      it('for umd module with arrow callback factory', async() => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory: arrowFactory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            factoryArguments,
            dependenciesCall,
            factory: arrowFactory
         }));
      });

      describe('for amd module with literal in deps array', () => {
         it('for amd module', async() => {
            const dynamicArrayDeps = '["UIModule/" + fn()]';
            const source = amd.format({
               moduleName,
               dependenciesCall: dynamicArrayDeps,
               factory
            });
            const program = parseCode(source, '', { ecmaVersion: 2021 });

            const result = await convert(program, source, 'amd', {
               filePath: `${moduleName}.js`,
               isCompiledFromTsc: false
            });

            expect(result.hasError).to.be.false;
            expect(result.amd).equals(amd.format({
               moduleName,
               dependenciesCall: dynamicArrayDeps,
               factory
            }));
         });
         it('for umd module', async() => {
            const dynamicArrayDeps = '["UIModule/" + fn()]';
            const source = amd.format({
               moduleName,
               dependenciesCall: dynamicArrayDeps,
               factory
            });
            const program = parseCode(source, '', { ecmaVersion: 2021 });

            const result = await convert(program, source, 'umd', {
               filePath: `${moduleName}.js`,
               isCompiledFromTsc: false
            });

            expect(result.hasError).to.be.false;
            expect(result.umd).equals(umd.format({
               moduleName,
               factoryArguments,
               dependenciesCall: dynamicArrayDeps,
               factory
            }));
         });
      });
   });
   describe('should process callback factory', () => {
      const moduleName = 'UIModule/dir/file';
      const factory = '(function() { /*body*/ })()';

      it('for amd module', async() => {
         const source = amd.format({
            moduleName,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            factory
         }));
      });
      it('for umd module', async() => {
         const source = amd.format({
            moduleName,
            factory
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, 'umd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.umd).equals(umd.format({
            moduleName,
            factory
         }));
      });
   });
   describe('should process unusual cases', () => {
      it('should process unknown source', async() => {
         const moduleName = 'UIModule/dir/file';
         const source = 'module.exports = function() {}';
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, ['amd', 'umd'], {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies: ['require', 'exports', 'module'],
            factory: toDefaultFactory(source)
         }));
         expect(result.umd).equals(source);
      });
      it('should hoist require dependencies with collisions', async() => {
         const moduleName = 'UIModule/dir/file';
         const factory = `function(require, exports) {
            var d3 = require("dep3");
            var d1 = require("dep1");
            var d2 = require("dep2");
            var d3_1 = require("dep3");
            var d3_2 = require("dep3");
         }`;
         const expectedFactory = `function(require, exports, d3, d1, d2, d3_1, d3_2) {
            
            
            
            
            
         }`;
         const source = umd.formatClassic({
            factory,
            dependencies: ['require', 'exports', 'dep3', 'dep1', 'dep2', 'dep3', 'dep3']
         });
         const program = parseCode(source, '', { ecmaVersion: 2021 });

         const result = await convert(program, source, ['amd'], {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies: ['require', 'exports', 'dep3', 'dep1', 'dep2', 'dep3', 'dep3'],
            factory: expectedFactory
         }));
      });
   });
});
