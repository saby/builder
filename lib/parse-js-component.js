'use strict';

const esprima = require('esprima-next');
const parseComponent = require('./esprima/parse-component');
const parseRoutes = require('./esprima/parse-route-component');
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

function modify(result, text, options) {
   let program;

   try {
      program = esprima.parse(text, {
         attachComment: true,
         range: true,
         source: true
      });
   } catch (error) {
      throw new Error(formatErrorMessage('parsing source text', error));
   }

   try {
      const targets = ['amd'];
      if (options.generateUMD) {
         targets.push('umd');
      }

      const convResult = convert(program, text, targets, {
         filePath: options.filePath,
         keepSourceMap: options.keepSourceMap,
         isCompiledFromTsc: options.isCompiledFromTsc,
         isRoutesFile: options.isRoutesFile
      });

      if (convResult.error) {
         throw convResult.error;
      }

      if (!convResult.hasError) {
         if (convResult.amd) {
            result.amdContent = convResult.amd;
         }
         if (convResult.umd) {
            result.umdContent = convResult.umd;
         }
      }
   } catch (error) {
      throw new Error(formatErrorMessage('amd/umd conversion error', error));
   }
}

function parse(result, text, options) {
   let program;

   try {
      program = esprima.parse(result.amdContent || text, {
         attachComment: true,
         range: true,
         source: true
      });
   } catch (error) {
      throw new Error(formatErrorMessage('parsing source text', error));
   }

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

module.exports = (text, options = { }) => {
   const startTime = Date.now();
   const result = { };

   modify(result, text, options);

   if (!options.isTestFile) {
      parse(result, text, options);
   }

   result.timestamp = {
      start: startTime,
      finish: Date.now()
   };

   return result;
};
