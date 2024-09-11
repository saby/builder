/* eslint-disable no-unused-expressions */
'use strict';

require('./init-test');

const { parse } = require('espree');
const { expect } = require('chai');

const { findExportsIdentifierName, checkModuleExports } = require('../lib/espree/generate-library');

const ESPREE_PARSE_OPTIONS = {
   range: true,
   source: true,
   ecmaVersion: 2019
};

describe('lib/espree/generate-library', () => {
   it('should process function declaration', () => {
      const code = ('function callback() { }');
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasBlockStatement).to.be.true;
      expect(Array.isArray(moduleExports.blockStatement)).to.be.true;
   });
   it('should process function expression', () => {
      const code = ('var callback = function() { }');
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasBlockStatement).to.be.true;
      expect(Array.isArray(moduleExports.blockStatement)).to.be.true;
   });
   it('should process arrow function expression', () => {
      const code = ('var callback = () => { }');
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasBlockStatement).to.be.true;
      expect(Array.isArray(moduleExports.blockStatement)).to.be.true;
   });

   it('should find exports identifier name', () => {
      const dependencies = ['require', 'exports'];
      const code = 'function callback(require, exports) { }';
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const exportsIdentifierName = findExportsIdentifierName(ast, dependencies);

      expect(exportsIdentifierName).to.equal('exports');
   });
   it('should find minified exports identifier name', () => {
      const dependencies = ['require', 'exports'];
      const code = 'function callback(a, b) { }';
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const exportsIdentifierName = findExportsIdentifierName(ast, dependencies);

      expect(exportsIdentifierName).to.equal('b');
   });
   it('should not find exports identifier name', () => {
      const dependencies = ['a', 'b'];
      const code = 'function callback(a, b) { }';
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const exportsIdentifierName = findExportsIdentifierName(ast, dependencies);

      expect(exportsIdentifierName).to.be.undefined;
   });

   it('should detect Object.defineProperty on exports', () => {
      const code = (`
         function callback(require, exports) {
            Object.defineProperty(exports, "__esModule", { value: true });
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasObjectDefinePropertyOnExports).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });
   it('should not detect Object.defineProperty on exports', () => {
      const code = (`
         function callback(require, exports) {
            Object.defineProperty(notExports, "__esModule", { value: true });
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasObjectDefinePropertyOnExports).to.be.false;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });
   it('should detect Object.defineProperty on exports in sequence expression', () => {
      const code = (`
         function callback(require, exports) {
            first(), Object.defineProperty(exports, "__esModule", { value: true }), second()
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasObjectDefinePropertyOnExports).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });
   it('should not detect Object.defineProperty on exports in sequence expression', () => {
      const code = (`
         function callback(require, exports) {
            first(), Object.defineProperty(notExports, "__esModule", { value: true }), second()
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasObjectDefinePropertyOnExports).to.be.false;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });

   it('should detect assignment expression on exports', () => {
      const code = (`
         function callback(require, exports) {
            exports.first = exports.second = exports.third = void 0;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasAssignmentExpressionOnExports).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });
   it('should not detect assignment expression on exports', () => {
      const code = (`
         function callback(require, exports) {
            notExports.first = notExports.second = notExports.third = void 0;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasAssignmentExpressionOnExports).to.be.false;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });
   it('should detect assignment expression on exports in sequence expression', () => {
      const code = (`
         function callback(require, exports) {
            exports.first = 0, exports.second = 1, exports.third = 2;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasAssignmentExpressionOnExports).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });
   it('should not detect assignment expression on exports in sequence expression', () => {
      const code = (`
         function callback(require, exports) {
            notExports.first = 0, notExports.second = 1, notExports.third = 2;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasAssignmentExpressionOnExports).to.be.false;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.true;
   });

   it('should detect return statement', () => {
      const code = (`
         function callback(require, exports) {
            return null;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasReturnStatement).to.be.true;
      expect(moduleExports.details.hasReturnExportsStatement).to.be.false;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.false;
   });
   it('should detect return sequence expression', () => {
      const code = (`
         function callback(require, exports) {
            return 0, 1, 2;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasReturnStatement).to.be.true;
      expect(moduleExports.details.hasReturnExportsStatement).to.be.false;
      expect(moduleExports.details.hasReturnSequenceExpression).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.false;
   });
   it('should detect return exports statement', () => {
      const code = (`
         function callback(require, exports) {
            return exports;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasReturnStatement).to.be.true;
      expect(moduleExports.details.hasReturnExportsStatement).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.false;
   });
   it('should detect return sequence expression with exports identifier', () => {
      const code = (`
         function callback(require, exports) {
            return 0, 1, 2, exports;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasReturnStatement).to.be.true;
      expect(moduleExports.details.hasReturnExportsStatement).to.be.true;
      expect(moduleExports.details.hasReturnSequenceExpression).to.be.true;

      expect(Array.isArray(moduleExports.returnSequenceStatement)).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.false;
      expect(moduleExports.shouldInsertReturnStatement).to.be.false;
   });

   it('should detect mixed export case with Object.defineProperty on exports', () => {
      const code = (`
         function callback(require, exports) {
            Object.defineProperty(exports, "__esModule", { value: true });
      
            return null;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasObjectDefinePropertyOnExports).to.be.true;
      expect(moduleExports.details.hasReturnStatement).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.true;
      expect(moduleExports.shouldInsertReturnStatement).to.be.false;
   });
   it('should detect mixed export case with assignment expression on exports', () => {
      const code = (`
         function callback(require, exports) {
            exports.first = exports.second = exports.third = void 0;
      
            return null;
         }
      `);
      const ast = parse(code, ESPREE_PARSE_OPTIONS);

      const moduleExports = checkModuleExports(ast, 'exports');

      expect(moduleExports.details.hasAssignmentExpressionOnExports).to.be.true;
      expect(moduleExports.details.hasReturnStatement).to.be.true;

      expect(moduleExports.shouldMergeModuleExports).to.be.true;
      expect(moduleExports.shouldInsertReturnStatement).to.be.false;
   });
});
