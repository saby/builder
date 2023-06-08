/* eslint-disable no-unused-expressions */
'use strict';

require('./init-test');

const { expect } = require('chai');
const { parse } = require('esprima-next');
const convert = require('../lib/es-converter');
const amd = require('../lib/es-converter/amd');
const umd = require('../lib/es-converter/umd-saby');

const PARSER_OPTIONS = {
   attachComment: true,
   range: true,
   source: true
};

const toDefaultFactory = content => `function(require, exports) {
${content}
}`;

const unknownSource = (`"use strict";
var global = (function () {
   // eslint-disable-next-line no-eval
   return this || (0, eval)('this');
})();
if (typeof (window) === 'undefined') {
   global.window = undefined;
}`);

describe('lib/es-converter', () => {
   describe('should insert module name', () => {
      const moduleName = 'UIModule/dir/file';
      const dependencies = ['require', 'exports', 'tslib'];
      const factoryArguments = ['global.requirejs', 'module.exports'];
      const factory = 'function(require, exports, tslib) {/*body*/}';
      const arrowFactory = '(require, exports, tslib) => {/*body*/}';

      it('anonymous amd module', () => {
         const source = amd.format({
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, ['amd', 'umd'], {
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
      it('anonymous umd module', () => {
         const source = umd.formatClassic({
            factoryArguments: ['require', 'exports'],
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('should correct amd module name', () => {
         const invalidModuleName = 'UIModule/Module';
         const source = amd.format({
            moduleName: invalidModuleName,
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('should correct umd module', () => {
         const invalidModuleName = 'UIModule/Module';
         const source = umd.formatClassic({
            moduleName: invalidModuleName,
            factoryArguments: ['require', 'exports'],
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('arrow factory function amd module', () => {
         const source = amd.format({
            dependencies,
            factory: arrowFactory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('arrow factory function umd module', () => {
         const source = umd.formatClassic({
            factoryArguments: ['require', 'exports'],
            dependencies,
            factory: arrowFactory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('parenthesis', () => {
         const source = '(function (factory) {\n' +
            '   if (typeof module === "object" && typeof module.exports === "object") {\n' +
            '      var v = factory(require,exports);\n' +
            '      if (v !== undefined) module.exports = v;\n' +
            '   }\n' +
            '   else if (typeof define === "function" && define.amd) {\n' +
            '      define(["require", "exports", "tslib"], factory);\n' +
            '   }\n' +
            '}(function(require, exports, tslib) {/*body*/}));';
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('from amd to amd', () => {
         const source = toSource(amd.format({
            moduleName,
            dependencies,
            factory
         }));
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('from amd to umd', () => {
         const source = toSource(amd.format({
            moduleName,
            dependencies,
            factory
         }));
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
      it('from umd to amd', () => {
         const source = toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factory,
            factoryArguments: ['require', 'exports']
         }));
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('from umd to umd', () => {
         const source = toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factory,
            factoryArguments: ['require', 'exports']
         }));
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
      it('to umd with keepSourceMap', () => {
         const source = toSource(umd.formatClassic({
            moduleName,
            dependencies,
            factory,
            factoryArguments: ['require', 'exports']
         }));
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
      const toFactory = deps => `function(d_0, d_1){${reqDeps(deps)}}`;

      const moduleName = 'UIModule/dir/file';
      const dependencies = ['./file1', '../file2'];
      const resolvedDependencies = ['UIModule/dir/file1', 'UIModule/file2'];

      const factory = toFactory(dependencies);
      const resolvedFactory = toFactory(resolvedDependencies);

      it('for amd module', () => {
         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('for amd module with no require in body', () => {
         const source = amd.format({
            moduleName,
            dependencies,
            factory: toFactory([])
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('for umd module', () => {
         const source = umd.formatClassic({
            moduleName,
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('should have no changes', () => {
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
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
      it('should resolve relative dependencies', () => {
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
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
      it('should resolve dependencies with ext', () => {
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
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
      it('should substitute deprecated names', () => {
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
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('for amd module', () => {
         const source = amd.format({
            moduleName,
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('for umd module', () => {
         const source = umd.formatClassic({
            moduleName,
            dependencies,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('for amd module', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('for umd module', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('for amd module with arrow deps function', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall: arrowDependenciesCall,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('for umd module with arrow deps function', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall: arrowDependenciesCall,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('for amd module with callback factory', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('for umd module with callback factory', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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

      it('for amd module with arrow callback factory', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory: arrowFactory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
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
      it('for umd module with arrow callback factory', () => {
         const source = amd.format({
            moduleName,
            dependenciesCall,
            factory: arrowFactory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
         it('for amd module', () => {
            const dynamicArrayDeps = '["UIModule/" + fn()]';
            const source = amd.format({
               moduleName,
               dependenciesCall: dynamicArrayDeps,
               factory
            });
            const program = parse(source, PARSER_OPTIONS);

            const result = convert(program, source, 'amd', {
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
         it('for umd module', () => {
            const dynamicArrayDeps = '["UIModule/" + fn()]';
            const source = amd.format({
               moduleName,
               dependenciesCall: dynamicArrayDeps,
               factory
            });
            const program = parse(source, PARSER_OPTIONS);

            const result = convert(program, source, 'umd', {
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

      it('for amd module', () => {
         const source = amd.format({
            moduleName,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'amd', {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            factory
         }));
      });
      it('for umd module', () => {
         const source = amd.format({
            moduleName,
            factory
         });
         const program = parse(source, PARSER_OPTIONS);

         const result = convert(program, source, 'umd', {
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
      it('process unknown module', () => {
         const moduleName = 'UIModule/dir/file';
         const program = parse(unknownSource, PARSER_OPTIONS);

         const result = convert(program, unknownSource, ['amd', 'umd'], {
            filePath: `${moduleName}.tsx`,
            isCompiledFromTsc: true
         });

         expect(result.hasError).to.be.false;
         expect(result.amd).equals(amd.format({
            moduleName,
            dependencies: ['require', 'exports'],
            factory: toDefaultFactory(unknownSource)
         }));
         expect(result.umd).equals(unknownSource);
      });
   });
});
