'use strict';

const { path } = require('./platform/path');
const terser = require('terser');

/* eslint-disable id-match */
const minifyOptionsBasic = {
   compress: {
      sequences: true,
      properties: false,
      dead_code: true,
      drop_debugger: true,
      conditionals: false,
      comparisons: false,
      evaluate: false,
      booleans: false,
      loops: false,
      hoist_funs: false,
      if_return: false,
      join_vars: true,
      warnings: false,
      negate_iife: false,
      keep_fargs: true,
      collapse_vars: true
   }
};

const minifyOptionsForMarkup = {
   compress: {
      conditionals: false,
      comparisons: false,
      evaluate: false,
      booleans: false,
      loops: false,
      unused: false,
      if_return: false,
      warnings: false,
      negate_iife: false,
      drop_debugger: false
   },
   mangle: { eval: true }
};
/* eslint-enable id-match */

async function runMinifyJs(filePath, text, ESVersion = 5, isMarkup = false, sourceMapUrl = '') {
   const startTime = Date.now();
   const minifyOptions = { ...(isMarkup ? minifyOptionsForMarkup : minifyOptionsBasic), ecma: ESVersion };
   if (sourceMapUrl) {
      minifyOptions.sourceMap = {
         url: sourceMapUrl,
         root: sourceMapUrl.replace('.map', '')
      };
   }

   const dataObject = {
      [path.basename(filePath)]: text
   };

   const minified = await terser.minify(dataObject, minifyOptions);
   if (minified.error) {
      throw new Error(JSON.stringify(minified.error));
   } else {
      return Object.assign(minified, {
         timestamp: {
            start: startTime,
            finish: Date.now()
         }
      });
   }
}

module.exports = runMinifyJs;
