/**
 * Модуль, предоставляющий функционал для замены повторяющихся селекторов в скомпилированных ресурсах CSS.
 * @author Krylov M.A.
 */
'use strict';

const { forEachRule, generateText } = require('./tree-shaker');
const { compileReplacer } = require('./replacer');

function clone(snapshot) {
   return JSON.parse(JSON.stringify(snapshot));
}

function modifySourceText(snapshot, ruleReplacements) {
   const clonedSnapshot = clone(snapshot);
   const replace = compileReplacer(ruleReplacements);

   let isChanged = false;

   forEachRule(clonedSnapshot, (ruleSeq, value, node) => {
      const rule = ruleSeq[ruleSeq.length - 1];
      let newRule = rule;

      // TODO: пересмотреть структуру снимков. на узлы нужно навесить порядковые номера.
      //    для css стилей порядок определения правил важен!
      if (typeof value === 'string') {
         newRule = replace(rule);

         if (rule !== newRule) {
            isChanged = true;
         }
      }

      delete node[rule];

      node[newRule] = value;
   });

   return isChanged
      ? generateText(clonedSnapshot, false)
      : undefined;
}

module.exports = modifySourceText;
