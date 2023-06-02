'use strict';

require('./init-test');

const runMinifyJs = require('../lib/run-minify-js');

describe('run uglify-js', () => {
   it('empty', async() => {
      const text = '';
      const result = await runMinifyJs('virtual.js', text);
      result.code.should.equal('');
   });
   it('uglifyjs-test-eval-minify', async() => {
      /**
       * uglifyJS может сломать конструкцию с определением глобального
       * объекта.
       * Если такое произошло, значит надо откатить версию uglify-js
       * и добиться работы данного теста.( и пожаловаться авторам сия чуда:))
       */

      const text = "(function(){ return this || (0,eval)('this'); }())";
      const result = await runMinifyJs('virtual.js', text);
      result.code.should.equal('(function(){this||(0,eval)("this")})();');
   });
   it('simple', async() => {
      const text = 'var r = 0;';
      const result = await runMinifyJs('virtual.js', text);
      result.code.should.equal('var r=0;');
   });
   it('simple test for typeof undefined', async() => {
      // нельзя заменять "undefined" === typeof test1 на void 0 === test1
      // это не равнозначные действия
      const text = 'if("undefined" === typeof test1){test2 = 0;}';

      const result = await runMinifyJs('virtual.js', text, false);
      result.code.should.equal('if("undefined"===typeof test1)test2=0;');

      const resultForMarkup = await runMinifyJs('virtual.js', text, true);
      resultForMarkup.code.should.equal('if("undefined"===typeof test1)test2=0;');
   });

   it('complex test for typeof undefined', async() => {
      // нельзя заменять "undefined" === typeof test1 на void 0 === test1
      // это не равнозначные действия

      const text =
         '(function() {\n' +
         "   var thelpers = typeof tclosure === 'undefined' || !tclosure ? arguments[arguments.length - 1] : tclosure;\n" +
         "   if (typeof thelpers === 'undefined') {\n" +
         '      console.log(1);\n' +
         '   }\n' +
         '})();';

      const result = await runMinifyJs('virtual.js', text, false);
      result.code.should.equal(
         '(function(){var e;if("undefined"===typeof("undefined"===typeof tclosure||!tclosure?arguments[arguments.length-1]:tclosure))console.log(1)})();'
      );

      const resultForMarkup = await runMinifyJs('virtual.js', text, true);
      resultForMarkup.code.should.equal(
         '(function(){var e;if("undefined"===typeof("undefined"===typeof tclosure||!tclosure?arguments[arguments.length-1]:tclosure))console.log(1)})();'
      );
   });
});
