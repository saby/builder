/* eslint-disable no-unused-expressions */
'use strict';

const { expect } = require('chai');

const TailwindTreeShaker = require('../lib/tailwind/tree-shaker');

const modifySourceText = require('../lib/tailwind/replace-css');

function createSnapshot(sourceText) {
   const shaker = new TailwindTreeShaker();

   shaker.shake(sourceText);

   return shaker.root;
}

describe('lib/tailwind/replace-css', () => {
   it('should replace target rules', () => {
      const snapshot = createSnapshot(`
         .tw-mt-auto{p:value}
         .tw-pr-\\[--offset_s\\]{p:value}
         .tw-w-\\[300px\\]{p:value}
         .hover\\:tw-underline:hover{p:value}
         .\\@\\[460px\\]\\:tw-order-2{p:value}
         .\\[\\&\\>\\:empty\\]\\:tw-hidden>:empty{p:value}
         .\\[\\&_\\.class\\\\_\\\\_name\\]\\:tw-p-0 .class__name{p:value}
         .before\\:tw-right-\\[100\\%\\]::before{p:value}
      `);
      const ruleReplacements = {
         '.tw-mt-auto': '.Module-tw-mt-auto',
         '.tw-pr-\\[--offset_s\\]': '.Module-tw-pr-\\[--offset_s\\]',
         '.tw-w-\\[300px\\]': '.Module-tw-w-\\[300px\\]',
         '.hover\\:tw-underline:hover': '.hover\\:Module-tw-underline:hover',
         '.\\@\\[460px\\]\\:tw-order-2': '.\\@\\[460px\\]\\:Module-tw-order-2',
         '.\\[\\&\\>\\:empty\\]\\:tw-hidden>:empty': '.\\[\\&\\>\\:empty\\]\\:Module-tw-hidden:empty',
         '.\\[\\&_\\.class\\\\_\\\\_name\\]\\:tw-p-0 .class__name': '.\\[\\&_\\.class\\\\_\\\\_name\\]\\:Module-tw-p-0 .class__name',
         '.before\\:tw-right-\\[100\\%\\]::before': '.before\\:Module-tw-right-\\[100\\%\\]::before'
      };

      const result = modifySourceText(snapshot, ruleReplacements);

      expect(result).to.equal(
         '' +
         '.Module-tw-mt-auto{p:value}' +
         '.Module-tw-pr-\\[--offset_s\\]{p:value}' +
         '.Module-tw-w-\\[300px\\]{p:value}' +
         '.hover\\:Module-tw-underline:hover{p:value}' +
         '.\\@\\[460px\\]\\:Module-tw-order-2{p:value}' +
         '.\\[\\&\\>\\:empty\\]\\:Module-tw-hidden:empty{p:value}' +
         '.\\[\\&_\\.class\\\\_\\\\_name\\]\\:Module-tw-p-0 .class__name{p:value}' +
         '.before\\:Module-tw-right-\\[100\\%\\]::before{p:value}'
      );
   });
   it('should have valid rules order', () => {
      const snapshot = createSnapshot(`
         .tw-mt{p:value}
         .tw-pr{p:value}
         .tw-w{p:value}
         @media (min-width:640px){
            .sm\\:tw-mt{p:value}
            .sm\\:tw-pr{p:value}
            .sm\\:tw-w{p:value}
         }
      `);
      const ruleReplacements = {
         '.tw-pr': '.Module-tw-pr',
         '.sm\\:tw-pr': '.sm\\:Module-tw-pr',
      };

      const result = modifySourceText(snapshot, ruleReplacements);

      expect(result).to.equal(
         '' +
         '.tw-mt{p:value}' +
         '.Module-tw-pr{p:value}' +
         '.tw-w{p:value}' +
         '@media (min-width:640px){' +
            '.sm\\:tw-mt{p:value}' +
            '.sm\\:Module-tw-pr{p:value}' +
            '.sm\\:tw-w{p:value}' +
         '}'
      );
   });
   it('should not replace substrings', () => {
      const snapshot = createSnapshot(`
         .tw-mt-auto{p:value}
         .tw-pr-\\[--offset_s\\]{p:value}
         .tw-w-\\[300px\\]{p:value}
         .hover\\:tw-underline:hover{p:value}
         .\\@\\[460px\\]\\:tw-order-2{p:value}
         .\\[\\&\\>\\:empty\\]\\:tw-hidden>:empty{p:value}
         .\\[\\&_\\.class\\\\_\\\\_name\\]\\:tw-p-0 .class__name{p:value}
         .before\\:tw-right-\\[100\\%\\]::before{p:value}
      `);
      const ruleReplacements = {
         '.tw-mt': '.Module-tw-mt',
         '.tw-pr': '.Module-tw-pr',
         '.tw-w': '.Module-tw-w',
         '.tw-underline': '.Module-tw-underline',
         '.tw-order-2': '.Module-tw-order-2',
         '.tw-hidden>': '.Module-tw-hidden',
         '.tw-p-0': '.Module-tw-p-0',
         '.tw-right-\\[100\\%\\]': '.Module-tw-right-\\[100\\%\\]'
      };

      const result = modifySourceText(snapshot, ruleReplacements);

      expect(result).to.be.undefined;
   });
});
