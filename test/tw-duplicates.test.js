'use strict';

const { expect } = require('chai');

const TailwindTreeShaker = require('../lib/tailwind/tree-shaker');
const { getTailwindDuplicates } = require('../lib/tailwind/duplicates');

function getTailwindInfo(source, module) {
   const shaker = new TailwindTreeShaker();

   shaker.shake(source);

   return {
      snapshot: shaker.root,
      module
   };
}

describe('lib/tailwind/duplicates', () => {
   it('should have duplicates', () => {
      const rule = '.tw-selector';
      const source = `${rule}{prop:value}`;
      const tailwindInfoSeq = [
         getTailwindInfo(source, 'First'),
         getTailwindInfo(source, 'Second'),
         getTailwindInfo(source, 'Third'),
      ];

      const table = getTailwindDuplicates(tailwindInfoSeq);

      const values = Array.from(table.values());

      expect(values.length).to.equal(1);

      expect(values[0].rule).to.equal(rule);
      expect(values[0].ruleSeq).to.deep.equal([rule]);
      expect(values[0].modules).to.deep.equal(tailwindInfoSeq.map(v => v.module));
   });

   it('should not have duplicates', () => {
      const tailwindInfoSeq = [
         getTailwindInfo('.tw-first{prop:value}', 'First'),
         getTailwindInfo('.tw-second{prop:value}', 'Second'),
         getTailwindInfo('.tw-third{prop:value}', 'Third'),
      ];

      const table = getTailwindDuplicates(tailwindInfoSeq);

      expect(table.size).to.equal(0);
   });

   it('should have clean class selector', () => {
      const source = `
         .tw-divide-x>:not([hidden])~:not([hidden]){prop:value}
      `;

      const tailwindInfoSeq = [
         getTailwindInfo(source, 'First'),
         getTailwindInfo(source, 'Second')
      ];

      const table = getTailwindDuplicates(tailwindInfoSeq);

      expect(table.size).equals(1);

      const element = Array.from(table.values()).pop();

      expect(element.rule).equals('.tw-divide-x>:not([hidden])~:not([hidden])');
      expect(element.selector).equals('tw-divide-x');
   });

   it('should have list of possible static selectors', () => {
      const source = `
         .tw-w-\\[255px\\]{prop:value}
         .tw-leading-\\[--inline_height_s\\]{prop:value}
         .hover\\:tw-underline:hover{prop:value}
         .tw-basis-0{prop:value}
         .tw-ml-4{prop:value}

         @container (min-width: 400px) {
            .\\@\\[400px\\]\\:tw-ml-4{prop:value}
         }
      `;

      const tailwindInfoSeq = [
         getTailwindInfo(source, 'First'),
         getTailwindInfo(source, 'Second'),
         getTailwindInfo(source, 'Third'),
      ];

      const table = getTailwindDuplicates(tailwindInfoSeq);

      const possibleStaticRules = Array.from(table.values())
         .filter(v => v.isPossibleStatic)
         .map(v => v.rule);

      expect(possibleStaticRules).to.deep.equal([
         '.tw-basis-0',
         '.tw-ml-4'
      ]);
   });
});
