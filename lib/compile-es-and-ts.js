/**
 * Основная библиотека по компиляции typescript исходника в
 * AMD-формате. Используется в соответствующем Gulp-плагине:
 * builder/gulp/builder/plugins/compile-es-and-ts.js
 * @author Kolbeshin F.A.
 */

'use strict';

const { transpileModule } = require('saby-typescript/lib/compiler'),
   transliterate = require('../lib/transliterate'),
   { formatErrorMessage } = require('../lib/helpers');

const normalizeDependencies = require('./esprima/modify-amd-dependencies');

/**
 * Get config object for TypeScript transpiler.
 * @param {string} relativePath The path to the source file relative to the interface module directory.
 * @param {string} moduleName The interface module name.
 * @param {object} compilerOptions TypeScript compiler options.
 * @param {boolean} needToRemoveModuleParam Flag to remove option "module" from config.
 * @param {boolean} sourceMaps Flag to build source maps.
 * @param {boolean} inlineSourceMaps Flag to build inline source maps.
 * @param {string} sourceRoot Path to source file.
 * @returns {object} Config object for TypeScript transpiler.
 */
function getTranspileOptions(
   relativePath,
   moduleName,
   compilerOptions,
   needToRemoveModuleParam,
   sourceMaps,
   inlineSourceMaps,
   sourceRoot
) {
   const currentCompilerOptions = {
      ...compilerOptions,
      inlineSourceMap: !!inlineSourceMaps,
      inlineSources: !!inlineSourceMaps
   };

   if (inlineSourceMaps) {
      currentCompilerOptions.sourceRoot = sourceRoot;
   }

   // prefer inline source maps to common source maps, they are more important
   if (!inlineSourceMaps) {
      currentCompilerOptions.sourceMap = !!sourceMaps;
   }

   if (needToRemoveModuleParam) {
      delete currentCompilerOptions.module;
   }

   return {
      compilerOptions: currentCompilerOptions,
      moduleName,
      fileName: relativePath
   };
}

function transpile(text, options) {
   const { outputText, sourceMapText } = transpileModule(text, options);

   return {
      outputText: getLostJestEnvironmentDocblock(text, outputText) + outputText,
      sourceMapText
   };
}

function getExtraMetaAboutModule(text, moduleName, relativePath) {
   // by default, typescript compiler uses CommonJs format for compiling typescript content
   const defineRegEx = new RegExp(`define\\(['"]${moduleName.split(/\\|\//).shift()}`);
   const removeModuleParam = defineRegEx.test(text) || relativePath.endsWith('.routes.ts');

   return { removeModuleParam };
}

function extractJestEnvironmentDocblock(text) {
   if (!text.startsWith('/*')) {
      return '';
   }

   const multilineCommentEnd = '*/';
   const comment = text.slice(0, text.indexOf(multilineCommentEnd) + multilineCommentEnd.length);
   if (comment.includes('@jest-environment')) {
      return comment;
   }

   return '';
}

function getLostJestEnvironmentDocblock(inputText, outputText) {
   const inputComment = extractJestEnvironmentDocblock(inputText);
   const outputComment = extractJestEnvironmentDocblock(outputText);

   if (inputComment && !outputComment) {
      return inputComment;
   }

   return '';
}

/**
 * Compile source text from TypeScript / ES6+ into ES5.
 * @param {string} relativePath The path to the source file relative to the interface module directory.
 * @param {string} sourceText Source text.
 * @param {string} interfaceModule The interface module name.
 * @param {object} compilerOptions TypeScript compiler options.
 * @param {boolean} sourceMaps Flag to build source maps.
 * @param {boolean} inlineSourceMaps Flag to build inline source maps.
 * @param {string} sourceRoot Path to source file.
 * @returns {object} Returns object - result of compilation.
 */
function compileEsAndTs(
   relativePath,
   sourceText,
   interfaceModule,
   compilerOptions = { development: {} },
   sourceMaps = false,
   inlineSourceMaps = false,
   sourceRoot = ''
) {
   const moduleName = transliterate(relativePath).replace(/\.(ts|tsx)$/, '');
   const result = {};
   const { removeModuleParam } = getExtraMetaAboutModule(sourceText, moduleName, relativePath);

   Object.keys(compilerOptions).forEach((currentBuildMode) => {
      const startTime = Date.now();
      const transpileOptions = getTranspileOptions(
         relativePath,
         moduleName,
         compilerOptions[currentBuildMode],
         removeModuleParam,
         sourceMaps,
         inlineSourceMaps,
         sourceRoot
      );

      let transpileResult;
      try {
         transpileResult = transpile(sourceText, transpileOptions);
      } catch (error) {
         throw new Error(`An error occurred while compiling js from ts source: ${error.message}\n${error.stack}`);
      }

      const { outputText, sourceMapText = '' } = transpileResult;
      try {
         result[currentBuildMode] = {
            ...normalizeDependencies(
               outputText,
               moduleName,
               interfaceModule
            ),
            sourceMapText,
            timestamp: {
               start: startTime,
               finish: Date.now()
            }
         };

         if (sourceMapText) {
            result[currentBuildMode].sourceMap = sourceMapText;
         }
      } catch (error) {
         const message = 'An error occurred while parsing compiled js file';
         throw new Error(formatErrorMessage(message, error, outputText));
      }
   });

   return result;
}

module.exports = {
   compileEsAndTs,
   getTranspileOptions,
   getExtraMetaAboutModule
};
