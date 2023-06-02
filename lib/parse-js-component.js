'use strict';

const { parseCode } = require('./espree/common');
const parseComponent = require('./espree/parse-component');
const parseRoutes = require('./espree/parse-route-component');
const convert = require('./es-converter');

function formatErrorMessage(type, error) {
   const chunks = [
      `Error occurred during ${type}: ${error.message}`
   ];

   if (error.stack) {
      chunks.push(
         ...error.stack.toString().split('\n').slice(1, 6)
      );
   }

   return chunks.join('\n');
}

async function modify(result, text, options) {
   const program = parseCode(
      text,
      'parsing source text',
      { comment: true, loc: true, ecmaVersion: options.ESVersion }
   );

   try {
      const targets = ['amd'];
      if (options.generateUMD) {
         targets.push('umd');
      }

      const convResult = await convert(program, text, targets, {
         filePath: options.filePath,
         isCompiledFromTsc: options.isCompiledFromTsc,
         isRoutesFile: options.isRoutesFile,
         sourceMap: options.sourceMap,
         ecmaVersion: options.ESVersion
      });

      if (convResult.error) {
         throw convResult.error;
      }

      if (!convResult.hasError) {
         if (convResult.amd) {
            result.amdContent = convResult.amd;
            result.amdSourceMap = convResult.amdSourceMap;
         }
         if (convResult.umd) {
            result.umdContent = convResult.umd;
            result.umdSourceMap = convResult.umdSourceMap;
         }
      }
   } catch (error) {
      throw new Error(formatErrorMessage('amd/umd conversion error', error));
   }
}

function parse(result, text, options) {
   const program = parseCode(
      result.amdContent || text,
      'parsing source text',
      {
         comment: true, ecmaVersion: options.ESVersion
      }
   );

   try {
      result.componentInfo = parseComponent(program, options);
   } catch (error) {
      throw new Error(formatErrorMessage('parsing component', error));
   }

   try {
      if (options.isRoutesFile) {
         result.routeInfo = parseRoutes(program);
      }
   } catch (error) {
      throw new Error(formatErrorMessage('parsing routes', error));
   }
}

module.exports = async(text, options = { }) => {
   const startTime = Date.now();
   const result = { };

   await modify(result, text, options);

   if (!options.isTestFile) {
      parse(result, text, options);
   }

   result.timestamp = {
      start: startTime,
      finish: Date.now()
   };

   return result;
};
