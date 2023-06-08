'use strict';
require('../lib/logger').setGulpLogger();
const { parse } = require('esprima-next');
const {
   getCommonVariablesNames,
   hasNoExports,
   getVoidExportsMeta,
   getExportsIndexesByValueName
} = require('../lib/pack/helpers/librarypack');
const { expect } = require('chai');

describe('library packer helpers', () => {
   describe('getCommonVariablesNames', () => {
      it('should return default value if not exist', () => {
         const { exportsName, tslibName } = getCommonVariablesNames(['dependency1', 'dependency2']);
         expect(exportsName).equal('exports');
         expect(tslibName).equal('tslib_1');
      });
      it('should return minified value from callback or return default value if not transmitted', () => {
         let testCode = "define('TestModule', ['dependency', 'require', 'exports'], function(dependency_1, require, s) { return {} })";
         let result = getCommonVariablesNames(
            ['dependency1', 'require', 'exports'],
            parse(testCode).body[0].expression.arguments[2]
         );
         expect(result.exportsName).equal('s');
         expect(result.tslibName).equal('tslib_1');
         testCode = "define('TestModule', ['dependency', 'tslib', 'exports'], function(dependency_1, ts_lib) { return {} })";
         result = getCommonVariablesNames(
            ['dependency1', 'tslib'],
            parse(testCode).body[0].expression.arguments[2]
         );
         expect(result.exportsName).equal('exports');
         expect(result.tslibName).equal('ts_lib');
      });
   });
   it('hasNoExports', () => {
      const dependencies = ['dependency', 'require', 'exports'];
      let testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
         'function(dependency_1, require, exports) {"use strict";Object.defineProperty(exports, "__esModule", { value: true }); })';
      let result = hasNoExports({
         dependencies,
         ast: parse(testCode).body[0].expression.arguments[2]
      });

      expect(result).equal(true);

      testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
         'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true }); exports.default = "123" })';
      result = hasNoExports({
         dependencies,
         ast: parse(testCode).body[0].expression.arguments[2]
      });
      expect(result).equal(false);

      testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
         'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true }); return { test: "123"} })';
      result = hasNoExports({
         dependencies,
         ast: parse(testCode).body[0].expression.arguments[2]
      });
      expect(result).equal(false);

      testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
         'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
         'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }}); })';
      result = hasNoExports({
         dependencies,
         ast: parse(testCode).body[0].expression.arguments[2]
      });
      expect(result).equal(false);

      testCode = "define('TestModule', ['dependency', 'require', 'exports'], function (dependency, require, exports) {" +
         '    "use strict";' +
         '    var global = (function () {' +
         "        return this || (0, eval)('this');" +
         '    })();' +
         "    if (typeof (process) === 'undefined') {" +
         '        global.process = undefined;' +
         '    }' +
         '});';
      result = hasNoExports({
         dependencies,
         ast: parse(testCode).body[0].expression.arguments[2]
      });
      expect(result).equal(false);

      testCode = "define('TestModule', ['dependency', 'require', 'exports', 'tslib'], function (dependency, require, exports, tslib_1) {" +
         'Object.defineProperty(exports, "__esModule", { value: true });' +
         'tslib_1.__exportStar(Interface_1, exports);' +
         '});';
      result = hasNoExports({
         dependencies,
         ast: parse(testCode).body[0].expression.arguments[2]
      });
      expect(result).equal(false);
   });
   describe('getVoidExportsMeta', () => {
      const dependencies = ['dependency', 'require', 'exports'];
      const prepareEnv = (testCode) => {
         const ast = parse(testCode).body[0].expression.arguments[2];
         return {
            ast,
            exportsVariableName: getCommonVariablesNames(dependencies, ast)
         };
      };
      describe('all exports', () => {
         it('module without exports', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true }); })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(0);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with return statement', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true }); return { test: "123" }})';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(0);
            expect(currentMeta.hasReturnStatement).equal(true);
         });

         it('module with defineproperty exports', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }}); })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with common exports', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'exports.default = { test: "123" } })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with sequence of common exports', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'exports.default = exports.MyInterface = { test: "123" } })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });
      });
      describe('exports by property value', () => {
         it('module without exports', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true }); })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(0);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with return statement', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true }); return { test: "123" }})';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(0);
            expect(currentMeta.hasReturnStatement).equal(true);
         });

         it('module with defineproperty exports with "default" value to search', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'Object.defineProperty(exports, "something", { enumerable: true, get: function() { return someVariable; }}); })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName, 'someVariable');
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with defineproperty exports with "ITest" value to search - not found', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }}); })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName, 'ITest');
            expect(currentMeta.currentModuleExports.length).equal(0);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with defineproperty exports with "ITest" value to search - exists, ITest is Literal', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }});' +
         'Object.defineProperty(exports, "test123", { enumerable: true, get: function() { return ITest; } });})';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName, 'ITest');
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with defineproperty exports with "ITest" value to search - exists, ITest is MemberExpression', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }});' +
               'Object.defineProperty(exports, "test123", { enumerable: true, get: function() { return ITest.default; }});})';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName, 'ITest');
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with common exports', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'exports.default = { test: "123" } })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });

         it('module with sequence of common exports', () => {
            const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
               'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
               'exports.default = exports.MyInterface = { test: "123" } })';
            const { ast, exportsVariableName } = prepareEnv(testCode);
            const currentMeta = getVoidExportsMeta(ast.body.body, exportsVariableName);
            expect(currentMeta.currentModuleExports.length).equal(1);
            expect(currentMeta.hasReturnStatement).equal(false);
         });
      });
   });
   describe('getExportsIndexesByValueName', () => {
      const dependencies = ['dependency', 'require', 'exports'];
      const prepareEnv = (testCode, deps) => {
         const ast = parse(testCode).body[0].expression.arguments[2];
         return {
            ast,
            exportsVariableName: getCommonVariablesNames(deps || dependencies, ast)
         };
      };

      it('module with defineproperty exports with "default" value to search', () => {
         const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
            'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
            'Object.defineProperty(exports, "something", { enumerable: true, get: function() { return someVariable; }}); })';
         const { ast, exportsVariableName } = prepareEnv(testCode);
         const { singleNodes } = getExportsIndexesByValueName(ast.body.body, exportsVariableName, 'someVariable');
         expect(singleNodes).to.have.members([1]);
      });

      it('module with defineproperty exports with "ITest" value to search - not found', () => {
         const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
            'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
            'exports.default = exports.something = void 0;' +
            'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }}); })';
         const { ast, exportsVariableName } = prepareEnv(testCode);
         const { singleNodes } = getExportsIndexesByValueName(ast.body.body, exportsVariableName, 'ITest');
         expect(singleNodes).to.have.members([]);
      });

      it('module with defineproperty exports with "ITest" value to search - exists, ITest is Literal', () => {
         const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
            'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
            'exports.default = exports.something = void 0;' +
            'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }});' +
            'Object.defineProperty(exports, "test123", { enumerable: true, get: function() { return ITest; } });})';
         const { ast, exportsVariableName } = prepareEnv(testCode);
         const { singleNodes } = getExportsIndexesByValueName(ast.body.body, exportsVariableName, 'ITest');
         expect(singleNodes).to.have.members([3]);
      });

      it('module with defineproperty exports with "ITest" value to search - exists, ITest is Literal, but in sequence, should return index in sequence', () => {
         const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
            'function(dependency_1, require, exports) { "use strict"; Object.defineProperty(exports, "__esModule", { value: true }),' +
            'exports.default = exports.something = void 0,' +
            'exports.default = ITest.someValue,' +
            'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }}),' +
            'Object.defineProperty(exports, "test123", { enumerable: true, get: function() { return ITest; } });})';
         const { ast, exportsVariableName } = prepareEnv(testCode);
         const { singleNodes, sequenceNodes } = getExportsIndexesByValueName(ast.body.body, exportsVariableName, 'ITest');
         expect(singleNodes).to.have.members([]);

         // index of root sequence node should be presented as key option
         expect(Object.keys(sequenceNodes)).to.have.members(['1']);

         // value of each found sequence should be an array of each found void interface
         expect(sequenceNodes['1']).to.have.members([2, 4]);
      });

      it('module with defineproperty exports with "ITest" value to search - exists, ITest is MemberExpression', () => {
         const testCode = "define('TestModule', ['dependency', 'require', 'exports']," +
            'function(dependency_1, require, exports) { Object.defineProperty(exports, "__esModule", { value: true });' +
            'exports.default = void 0;' +
            'Object.defineProperty(exports, "test123", { enumerable: true, get: function() { return ITest.default; }});' +
            'Object.defineProperty(exports, "default", { enumerable: true, get: function() { return { test: "123" }; }});' +
            'exports.ISomething = ITest.someInterface;' +
            'exports.someAnother = dependency_1;' +
            'exports.ISomething1 = ITest;});';
         const { ast, exportsVariableName } = prepareEnv(testCode);
         const { singleNodes } = getExportsIndexesByValueName(ast.body.body, exportsVariableName, 'ITest');
         expect(singleNodes).to.have.members([2, 4, 6]);
      });
      it('tslib.__exportStar should be added too', () => {
         const testCode = "define('TestModule', ['dependency', 'require', 'exports', 'tslib'], function (dependency, require, exports, tslib_1) {" +
            '            Object.defineProperty(exports, "__esModule", { value: true });\n' +
            '            exports.creators = exports.IBody = exports.IPageTagAPI = exports.JSLinks = exports.Body = exports.Head = void 0;\n' +
            '            Object.defineProperty(exports, "Head", { enumerable: true, get: function () { return Head_1.Head; } });\n' +
            '            tslib_1.__exportStar(Interface_1, exports);\n' +
            '            tslib_1.__exportStar(ITest, exports);\n' +
            '            Object.defineProperty(exports, "IPageTagAPI", { enumerable: true, get: function () { return Interface_2.IPageTagAPI; } });\n' +
            '            Object.defineProperty(exports, "ITestProperty", { enumerable: true, get: function () { return ITest.IBody; } });\n' +
            '            exports.creators = creators;\n' +
            '         });';
         const { ast, exportsVariableName } = prepareEnv(testCode, ['dependency', 'require', 'exports', 'tslib']);
         const { singleNodes } = getExportsIndexesByValueName(ast.body.body, exportsVariableName, 'ITest');
         expect(singleNodes).to.have.members([4, 6]);
      });
   });
});
