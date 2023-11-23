'use strict';

const { parseCode } = require('./espree/common');
const parseComponent = require('./espree/parse-component');
const parseRoutes = require('./espree/parse-route-component');
const convert = require('./es-converter');
const { formatProcessingError } = require('./format-error');

function generateErrorMessage(type, error) {
   return formatProcessingError(error, `Error occurred during ${type}:`);
}

async function modify(result, text, options) {
   const program = parseCode(
      text,
      { comment: true, loc: true, ecmaVersion: options.ESVersion }
   );

   try {
      const targets = ['amd'];
      if (options.generateUMD) {
         targets.push('umd');
      }

      const convResult = await convert(program, text, targets, {
         filePath: options.filePath,
         sourceFilePath: options.sourceFilePath,
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
      throw Object.assign(new Error(), {
         message: generateErrorMessage('amd/umd conversion error', error),
         stack: null
      });
   }
}

function parse(result, text, options) {
   const program = parseCode(
      result.amdContent || text,
      {
         comment: true, ecmaVersion: options.ESVersion
      }
   );

   try {
      result.componentInfo = parseComponent(program, options);
   } catch (error) {
      throw Object.assign(new Error(), {
         message: generateErrorMessage('parsing component', error),
         stack: null
      });
   }

   try {
      if (options.isRoutesFile) {
         result.routeInfo = parseRoutes(program);
      }
   } catch (error) {
      throw Object.assign(new Error(), {
         message: generateErrorMessage('parsing routes', error),
         stack: null
      });
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
