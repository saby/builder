'use strict';

const esprima = require('esprima-next');
const modifyPromiseCatch = require('../esprima/modify-promise-catch');

function patch(program, source) {
   const patchedSource = modifyPromiseCatch(program);

   if (!patchedSource) {
      return [program, source];
   }

   const patchedProgram = esprima.parse(patchedSource, {
      attachComment: true,
      range: true,
      source: true
   });

   return [patchedProgram, patchedSource];
}

module.exports = patch;
