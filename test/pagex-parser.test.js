'use strict';

const { expect } = require('chai');

const parseSourceFile = require('../lib/pagex/parser');

async function expectRejected(promise, errorMessage) {
   let error;

   try {
      await promise;
   } catch (e) {
      error = e;
   }

   expect(error).to.be.an('Error');

   if (errorMessage) {
      expect(error.message).to.equal(errorMessage);
   }
}

describe('lib/pagex/parser', () => {
   const filePath = 'module/path/to/file.pagex';

   it('should fail parsing xml', async() => {
      await expectRejected(
         parseSourceFile(filePath, '&!'),
         'Non-whitespace before first tag. Line: 0 Column: 1 Char: &'
      );
   });

   it('should parse empty file', async() => {
      const results = await parseSourceFile(filePath, '');

      expect(results).to.deep.equal([]);
   });

   it('should parse empty file 2', async() => {
      const results = await parseSourceFile(filePath, '<not-a-page></not-a-page>');

      expect(results).to.deep.equal([]);
   });

   it('should parse empty file 3', async() => {
      const results = await parseSourceFile(filePath, '<page><not-an-item></not-an-item></page>');

      expect(results).to.deep.equal([]);
   });

   it('should fail parsing id', async() => {
      await expectRejected(
         parseSourceFile(filePath, '<page><item></item></page>'),
         'Тег item не содержит атрибутов'
      );
   });

   it('should fail parsing contentConfig value', async() => {
      await expectRejected(
         parseSourceFile(filePath, '<page><item id="123" type="456"><contentConfig>---</contentConfig></item></page>'),
         'Unexpected number in JSON at position 1 in contentConfig at item "123"'
      );
   });

   it('should parse item data', async() => {
      const items = [
         {
            id: 'id-1',
            type: 'type-1',
            contentConfig: {
               value: '1'
            },
            filePath
         },
         {
            id: 'id-2',
            type: 'type-2',
            contentConfig: {
               value: '2'
            },
            filePath
         }
      ];

      const toCfg = item => (
         `<contentConfig>${JSON.stringify(item.contentConfig)}</contentConfig>`
      );

      const toItem = item => (
         `<item id="${item.id}" type="${item.type}">${toCfg(item)}</item>`
      );

      const result = await parseSourceFile(filePath, `<page>${items.map(toItem)}</page>`);

      expect(result).to.deep.equal(items);
   });
});
