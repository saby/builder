'use strict';

const { expect } = require('chai');

const modifySourceText = require('../lib/tailwind/replace-text');

function wrapSourceText(fragment) {
   return (`
      define(['exports'], function(exports) {
         'use strict';

         function fn() {
            return ${fragment};
         }
         
         exports.fn = fn;
      });
   `);
}

function generateObjectForReplacement(values) {
   const pairs = [];

   values.forEach((value, index) => {
      pairs.push(`'prop_${index}_a': '${value}'`);
      pairs.push(`'prop_${index}_b': 'before ${value}'`);
      pairs.push(`'prop_${index}_c': 'before ${value} after'`);
      pairs.push(`'prop_${index}_d': '${value} after'`);

      pairs.push(`'prop_${index}_e': \`\${before} ${value}\``);
      pairs.push(`'prop_${index}_f': \`\${before} ${value} \${after}\``);
      pairs.push(`'prop_${index}_g': \`${value} \${after}\``);
   });

   return `{\n${pairs.join(',\n')}\n}`;
}

describe('lib/tailwind/replace-text', () => {
   it('should replace target selectors', () => {
      const selectorReplacements = {
         'tw-mt-auto': 'Module-tw-mt-auto',
         'tw-pr-[--offset_s]': 'Module-tw-pr-[--offset_s]',
         'tw-w-[300px]': 'Module-tw-w-[300px]',
         'hover:tw-underline:hover': 'hover:Module-tw-underline:hover',
         '@[460px]:tw-order-2': '@[460px]:Module-tw-order-2',
         '[&>:empty]:tw-hidden': '[&>:empty]:Module-tw-hidden',
         '[&_.class__name]:tw-p-0': '[&_.class__name]:Module-tw-p-0',
         'before:tw-right-[100%]': 'before:Module-tw-right-[100%]'
      };
      const sourceText = wrapSourceText(generateObjectForReplacement(
         Object.keys(selectorReplacements)
      ));

      const result = modifySourceText(sourceText, selectorReplacements);

      const expectedSourceText = wrapSourceText(generateObjectForReplacement(
         Object.values(selectorReplacements)
      ));

      expect(result).to.equal(expectedSourceText);
   });

   it('should not replace substrings', () => {
      const selectorReplacements = {
         'tw-mt': 'Module-tw-mt',
         'tw-pr': 'Module-tw-pr',
         'tw-w-[300px]': 'Module-tw-w-[300px]',
         'tw-underline': 'Module-tw-underline',
         'tw-order-2': 'Module-tw-order-2',
         'tw-hidden': 'Module-tw-hidden',
         'tw-p-0': 'Module-tw-p-0',
         'tw-right': 'Module-tw-right'
      };

      const sourceText = wrapSourceText(generateObjectForReplacement([
         'tw-mt-auto',
         'tw-mt:hover',
         'tw-pr-[--offset_s]',
         '@[460px]:tw-order-2',
         'hover:tw-underline',
         '[&>:empty]:tw-hidden',
         '[&_.spCard__header]:tw-p-0',
         'before:tw-right-[100%]'
      ]));

      const result = modifySourceText(sourceText, selectorReplacements);

      expect(result).to.equal(sourceText);
   });
});
