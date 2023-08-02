'use strict';

const SPECIAL_DEPENDENCIES = ['require', 'exports', 'module'];
const REQUIRE_NAME = 'global.requirejs';
const { parse } = require('espree');

const ESPREE_PARSE_OPTIONS = {
   range: true,
   source: true
};
const QUOTES_TYPE = 'double';
const ES_GENERATOR_OPTIONS = {
   format: {
      compact: false,
      quotes: QUOTES_TYPE,
      parentheses: true,
      semicolons: true
   }
};
const ES_GENERATOR_OPTIONS_COMPACT = {
   ...ES_GENERATOR_OPTIONS,
   format: {
      ...ES_GENERATOR_OPTIONS.format,
      compact: true
   }
};

function wrapWithQuotes(text) {
   if (QUOTES_TYPE === 'double') {
      return `"${text}"`;
   }

   return `'${text}'`;
}

function createIdentifierName(name) {
   const letter = name.charAt(0).replace(/[^_$a-z]/gi, '_');
   const tail = name.slice(1).replace(/[^_$a-z0-9]/gi, '_');

   return letter + tail;
}

function createFactoryArgument(dependency, create = createIdentifierName) {
   if (dependency === 'require') {
      return REQUIRE_NAME;
   }

   if (dependency === 'module') {
      return 'module';
   }

   if (dependency === 'exports') {
      return 'module.exports';
   }

   return create(dependency);
}

/**
 * returns an array of strings of code with a one
 * that has an error, marked with a ">>>>" sign to
 * be distinguished from another one.
 * @param{text} - current code text
 * @param{Number} lineWithError - line of code with error
 * @returns {String}
 */
function visualizeErrorInCodeWithLine(text, lineWithError) {
   // split compiled text by newline characters
   const textLines = text.split(/\r\n|\r|\n/g);
   const result = [];
   for (let currentLine = lineWithError - 10; currentLine <= lineWithError + 10; currentLine++) {
      if (currentLine === lineWithError - 1) {
         result.push(`${currentLine + 1}: >>>>>>>>>>>>>>>>>${textLines[currentLine]}`);
      } else {
         result.push(`${currentLine + 1}:${textLines[currentLine]}`);
      }
   }
   return result.join('\n');
}

function formatErrorMessage(startMessage, error, outputText) {
   const message = [`${startMessage}: ${error.message}`];

   if (error.lineNumber) {
      message.push(visualizeErrorInCodeWithLine(outputText, error.lineNumber));
   }
   message.push(error.stack);

   return message.join('\n');
}

function parseCode(text, errorMessage, extraOptions = {}) {
   try {
      if (!extraOptions.ecmaVersion) {
         if (process.env.ESVersion) {
            extraOptions.ecmaVersion = Number(process.env.ESVersion);
         } else {
            extraOptions.ecmaVersion = 5;
         }
      }

      const ast = parse(
         text,
         { ...ESPREE_PARSE_OPTIONS, ...extraOptions }
      );
      return ast;
   } catch (error) {
      if (errorMessage) {
         throw new Error(formatErrorMessage(errorMessage, error, text));
      }
      throw new Error(error);
   }
}

module.exports = {
   SPECIAL_DEPENDENCIES,
   REQUIRE_NAME,
   ES_GENERATOR_OPTIONS,
   ES_GENERATOR_OPTIONS_COMPACT,
   wrapWithQuotes,
   createIdentifierName,
   createFactoryArgument,
   formatErrorMessage,
   parseCode
};
