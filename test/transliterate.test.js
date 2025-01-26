'use strict';

require('./init-test');

const transliterate = require('../lib/transliterate');

describe('transliterate', () => {
   it('lower case', () => {
      transliterate('тест').should.equal('test');
   });
   it('upper case', () => {
      transliterate('ТЕСТ').should.equal('TEST');
   });
   it('tricky chars', () => {
      transliterate('Я я').should.equal('YA_ya');
      transliterate('Ъ ъ').should.equal('_');
      transliterate('Ь ь').should.equal('_');
      transliterate('Ё ё').should.equal('E_e');
      transliterate('Ю ю').should.equal('YU_yu');
      transliterate('Щ щ').should.equal('SCH_sch');
      transliterate('Й й').should.equal('J_j');
   });
   it('english with punctuation', () => {
      transliterate('Simple.Test').should.equal('Simple.Test');
   });
});
