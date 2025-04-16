'use strict';

require('./init-test');

const stubFsExtra = require('./helpers/stub-fs');

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
   const rootPath = '/path/to/';
   const filePath = '/path/to/module/path/to/file.pagex';
   const relFilePath = 'module/path/to/file.pagex';

   let fs;

   before(() => {
      fs = stubFsExtra(process.cwd());
   });

   after(() => {
      fs.restore();
   });

   it('should fail parsing xml', async() => {
      fs.stubFile(filePath, '&!');

      await expectRejected(
         parseSourceFile(rootPath, filePath),
         'Non-whitespace before first tag. Line: 0 Column: 1 Char: &'
      );
   });

   it('should parse empty file', async() => {
      fs.stubFile(filePath, '');

      const results = await parseSourceFile(rootPath, filePath);

      expect(results).to.deep.equal([]);
   });

   it('should parse empty file 2', async() => {
      fs.stubFile(filePath, '<not-a-page></not-a-page>');

      const results = await parseSourceFile(rootPath, filePath);

      expect(results).to.deep.equal([]);
   });

   it('should parse empty file 3', async() => {
      fs.stubFile(filePath, '<page><not-an-item></not-an-item></page>');

      const results = await parseSourceFile(rootPath, filePath);

      expect(results).to.deep.equal([]);
   });

   it('should fail parsing id', async() => {
      fs.stubFile(filePath, '<page><item></item></page>');

      await expectRejected(
         parseSourceFile(rootPath, filePath),
         'Тег item не содержит атрибутов'
      );
   });

   it('should fail parsing type', async() => {
      fs.stubFile(filePath, '<page><item id="123"></item></page>');

      await expectRejected(
         parseSourceFile(rootPath, filePath),
         'Тег item не содержит обязательного атрибута type'
      );
   });

   it('should fail parsing contentConfig', async() => {
      fs.stubFile(filePath, '<page><item id="123" type="456"></item></page>');

      await expectRejected(
         parseSourceFile(rootPath, filePath),
         'Тег item не содержит обязательного тега contentConfig'
      );
   });

   it('should fail parsing contentConfig value', async() => {
      fs.stubFile(filePath, '<page><item id="123" type="456"><contentConfig>---</contentConfig></item></page>');

      await expectRejected(
         parseSourceFile(rootPath, filePath),
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
            filePath: relFilePath
         },
         {
            id: 'id-2',
            type: 'type-2',
            contentConfig: {
               value: '2'
            },
            filePath: relFilePath
         }
      ];

      const toCfg = item => (
         `<contentConfig>${JSON.stringify(item.contentConfig)}</contentConfig>`
      );

      const toItem = item => (
         `<item id="${item.id}" type="${item.type}">${toCfg(item)}</item>`
      );

      fs.stubFile(filePath, `<page>${items.map(toItem)}</page>`);

      const result = await parseSourceFile(rootPath, filePath);

      expect(result).to.deep.equal(items);
   });
});
