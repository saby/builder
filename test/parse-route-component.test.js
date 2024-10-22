'use strict';

require('./init-test');

const { parseCode } = require('../lib/espree/common');
const parseRoutes = require('../lib/espree/parse-route-component');
const { expect } = require('chai');

describe('lib/esprima/parse-route-component', () => {
   it('should return empty routes on empty source file', () => {
      const ast = parseCode('');
      const result = parseRoutes(ast);
      Object.getOwnPropertyNames(result).length.should.equal(0);
   });
   it('should return route controllers', () => {
      const routes = {
         '/test_1.html': 'js!SBIS3.Test1',
         '/test_2.html': 'js!SBIS3.Test2'
      };
      const text = `
         module.exports = function() {
            return ${JSON.stringify(routes)};
         };
      `;
      const ast = parseCode(text);
      const result = parseRoutes(ast);

      const expectedRoutes = {
         '/test_1.html': {
            controller: 'js!SBIS3.Test1'
         },
         '/test_2.html': {
            controller: 'js!SBIS3.Test2'
         }
      };
      expect(result).to.deep.equal(expectedRoutes);
   });
   it('should return route controllers with arrow function', () => {
      const routes = {
         '/test_1.html': 'js!SBIS3.Test1',
         '/test_2.html': 'js!SBIS3.Test2'
      };
      const text = `
         module.exports = () => {
            return ${JSON.stringify(routes)};
         };
      `;
      const ast = parseCode(text, {
         ecmaVersion: 2021
      });
      const result = parseRoutes(ast);

      const expectedRoutes = {
         '/test_1.html': {
            controller: 'js!SBIS3.Test1'
         },
         '/test_2.html': {
            controller: 'js!SBIS3.Test2'
         }
      };
      expect(result).to.deep.equal(expectedRoutes);
   });
   it('should return null controller in case of function', () => {
      const text = `
         module.exports = function (Component, Service) {
            return {
               '/test_1/': function (req, res) { /* some code */ },
               '/test_2/': function (req, res) { /* some code */ }
            };
         };
      `;
      const ast = parseCode(text);
      const result = parseRoutes(ast);

      const expectedRoutes = {
         '/test_1/': {
            controller: null
         },
         '/test_2/': {
            controller: null
         }
      };
      expect(result).to.deep.equal(expectedRoutes);
   });
   it('should return null controller in case of function with arrow function', () => {
      const text = `
         module.exports = (Component, Service) => {
            return {
               '/test_1/': (req, res) => { /* some code */ },
               '/test_2/': (req, res) => { /* some code */ }
            };
         };
      `;
      const ast = parseCode(text, {
         ecmaVersion: 2021
      });
      const result = parseRoutes(ast);

      const expectedRoutes = {
         '/test_1/': {
            controller: null
         },
         '/test_2/': {
            controller: null
         }
      };
      expect(result).to.deep.equal(expectedRoutes);
   });
   it('should return null controller in ES2021 compilation', () => {
      const text = `
         module.exports = (Component, Service) => ({
            '/test_1/': (req, res) => { /* some code */ },
            '/test_2/': (req, res) => { /* some code */ }
         });
      `;
      const ast = parseCode(text, {
         ecmaVersion: 2021
      });
      const result = parseRoutes(ast);

      const expectedRoutes = {
         '/test_1/': {
            controller: null
         },
         '/test_2/': {
            controller: null
         }
      };
      expect(result).to.deep.equal(expectedRoutes);
   });
   it('should return null controller in case of ident referring to function', () => {
      const text = `
         function generateTest1(req, res) {
            // some code
         }
         function generateTest2(req, res) {
            // some code
         }
         module.exports = function (Component, Service) {
            return {
               '/test_1/': generateTest1,
               '/test_2/': generateTest2
            };
         };
      `;
      const ast = parseCode(text);
      const result = parseRoutes(ast);

      const expectedRoutes = {
         '/test_1/': {
            controller: null
         },
         '/test_2/': {
            controller: null
         }
      };
      expect(result).to.deep.equal(expectedRoutes);
   });
   it('should throw invalid routes error', () => {
      // примеры не корретного роутинга:
      // - ключ роутинга не начинаться с слеша
      // - значение роутинго - объект
      const text = `
         module.exports = function (Component, Service) {
            return {
               "test_1": "TEST",
               "/test_2/": { }
            };
         };
      `;
      const errorMessage = (
         'Некоторые роутинги не являются корректными. ' +
         'Роутинг должен задаваться строкой, которая начинается с символа "/". ' +
         'Список некорректных роутингов: test_1'
      );

      expect(() => {
         const ast = parseCode(text);
         parseRoutes(ast);
      }).to.throw(errorMessage);
   });
   it('should throw invalid export error', () => {
      const text = 'module.exports = "TEST";';
      const errorMessage = 'Экспортируется не объект и не функция';

      expect(() => {
         const ast = parseCode(text);
         parseRoutes(ast);
      }).to.throw(errorMessage);
   });
});
