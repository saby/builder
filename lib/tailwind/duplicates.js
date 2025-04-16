/**
 * Модуль, предоставляющий функционал для анализа повторяющихся селекторов Tailwind.
 * @author Krylov M.A.
 */
'use strict';

const { forEachRule } = require('./tree-shaker');

const RULE_SEQ_SEP = '=:=';
const CSS_SELECTOR_REGEX = /([^+>\s~]+)/;

function getRuleSeqHash(ruleSeq) {
   return ruleSeq.join(RULE_SEQ_SEP);
}

function getClassSelector(rule) {
   const possiblyComplexSelector = rule
      .replace(/^\./gi, '')
      .replace(/\\/gi, '');

   // Селектор может содержать комбинаторы в сгенерированном CSS,
   // но они отсутствуют в исходном тексте. Необходимо очистить селектор
   if (CSS_SELECTOR_REGEX.test(possiblyComplexSelector)) {
      const [, classSelector] = CSS_SELECTOR_REGEX.exec(possiblyComplexSelector);

      return classSelector;
   }

   return possiblyComplexSelector;
}

function isPossibleStaticSelector(rule) {
   return !/[@[\]:]/gi.test(rule);
}

function fillWithRules(table, tailwindInfoSeq) {
   for (const tailwindInfo of tailwindInfoSeq) {
      forEachRule(tailwindInfo.snapshot, (ruleSeq, value) => {
         if (typeof value !== 'string') {
            return;
         }

         const ruleSeqHash = getRuleSeqHash(ruleSeq);

         if (!table.has(ruleSeqHash)) {
            const rule = ruleSeq[ruleSeq.length - 1];

            table.set(ruleSeqHash, {
               rule,
               ruleSeq,
               selector: getClassSelector(rule),
               isPossibleStatic: isPossibleStaticSelector(rule),
               modules: []
            });
         }

         const entity = table.get(ruleSeqHash);

         entity.modules.push(tailwindInfo.module);
      });
   }
}

function pruneTable(table) {
   for (const ruleSeqHash of table.keys()) {
      if (table.get(ruleSeqHash).modules.length < 2) {
         table.delete(ruleSeqHash);
      }
   }
}

function getTailwindDuplicates(tailwindInfoSeq) {
   const table = new Map();

   fillWithRules(table, tailwindInfoSeq);

   pruneTable(table);

   return table;
}

function getTailwindReplacers(table) {
   const twReplacersSeq = new Map();

   table.forEach((entity) => {
      for (const module of entity.modules) {
         if (!twReplacersSeq.has(module)) {
            twReplacersSeq.set(module, {
               rules: { /* for css code */ },
               selectors: { /* for js code */ }
            });
         }

         const replacers = twReplacersSeq.get(module);

         replacers.rules[entity.rule] = entity.rule
            .replace(/^\.tw-/gi, `.${module}-tw-`)
            .replace(/:tw-/gi, `:${module}-tw-`);

         replacers.selectors[entity.selector] = entity.selector
            .replace(/^tw-/gi, `${module}-tw-`)
            .replace(/:tw-/gi, `:${module}-tw-`);
      }
   });

   return twReplacersSeq;
}

module.exports = {
   getTailwindDuplicates,
   getTailwindReplacers
};
