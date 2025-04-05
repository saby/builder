/**
 * Модуль, предоставляющий функционал для замены повторяющихся селекторов в ресурсах TMPL, WML.
 * @author Krylov M.A.
 */
'use strict';

const { compileReplacer } = require('./replacer');

function modifySourceText(sourceText, selectorReplacements) {
   const replace = compileReplacer(selectorReplacements);

   return replace(sourceText);
}

module.exports = modifySourceText;
