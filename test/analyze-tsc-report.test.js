'use strict';

require('./init-test');
const chai = require('chai');
const { expect } = chai;

const { parseMessage, forEachMessage } = require('../gulp/builder/generate-task/typescript/analyze-report');

describe('gulp/builder/generate-task/typescript/analyze-report', () => {
   const loc = '(1,2)';
   const code = 1234;
   const errorMessage = 'Error message\n  New line\n    Other line';

   describe('check parseMessage function', () => {
      it('should parse out of project message', () => {
         const file = '../../../a/b/c/node_modules/typescript/lib/lib.dom.d.ts';
         const message = `${file}${loc}: error TS${code}: ${errorMessage}`;
         const info = parseMessage(message);

         expect(info.raw).to.equal(message);
         expect(info.file.path).to.equal(file);
         expect(info.file.loc).to.equal(loc);
         expect(info.code).to.equal(code);
         expect(info.message).to.equal(errorMessage);
      });
      it('should parse system message', () => {
         const message = `error TS${code}: ${errorMessage}`;
         const info = parseMessage(message);

         expect(info.raw).to.equal(message);
         expect(info.code).to.equal(code);
         expect(info.message).to.equal(errorMessage);
      });
      it('should parse project message', () => {
         const moduleName = 'ModuleName';
         const file = `${moduleName}/file.ts`;
         const message = `${file}${loc}: error TS${code}: ${errorMessage}`;
         const info = parseMessage(message);

         expect(info.raw).to.equal(message);
         expect(info.file.path).to.equal(file);
         expect(info.file.loc).to.equal(loc);
         expect(info.location.module).to.equal(moduleName);
         expect(info.code).to.equal(code);
         expect(info.message).to.equal(errorMessage);
      });
      it('should parse modified message', () => {
         const moduleName = 'ModuleName';
         const file = `${moduleName}/file.ts`;
         const location = `location: [module: ${moduleName} (Smith. J.)]`;
         const message = `${location} ${file}${loc}: error TS${code}: ${errorMessage}`;
         const info = parseMessage(message);

         expect(info.raw).to.equal(message);
         expect(info.file.path).to.equal(file);
         expect(info.file.loc).to.equal(loc);
         expect(info.location.module).to.equal(moduleName);
         expect(info.code).to.equal(code);
         expect(info.message).to.equal(errorMessage);
      });
   });

   describe('check forEachMessage function', () => {
      it('should process multiline messages', () => {
         const firstMessage = `ModuleName/firstFile.ts${loc}: error TS${code}: ${errorMessage}`;
         const secondMessage = `ModuleName/secondFile.ts${loc}: error TS${code}: ${errorMessage}`;
         const text = `${firstMessage}\n${secondMessage}`;
         const messages = [];
         forEachMessage(text, info => messages.push(info));

         expect(messages.map(info => info.raw)).to.deep.equal([
            firstMessage,
            secondMessage
         ]);
      });
   });
});
