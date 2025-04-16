'use strict';

function createSafeRegEx(template) {
   return template
      .replace(/[[\]$^()?+*:,|\\.]/g, '\\$&');
}

function createReplacer(pattern, value) {
   return {
      re: new RegExp(pattern, 'g'),
      replacement: value,
      test(string) {
         this.re.lastIndex = 0;

         return this.re.test(string);
      },
      replace(string) {
         this.re.lastIndex = 0;

         return string.replace(this.re, (match, group) => match.replace(group, this.replacement));
      }
   };
}

function compileReplacer(selectorReplacements) {
   const replacers = [];

   for (const key in selectorReplacements) {
      if (selectorReplacements.hasOwnProperty(key)) {
         const template = createSafeRegEx(key);

         replacers.push(createReplacer(`[^:-](${template})[^:\\-\\[\\]]`, selectorReplacements[key]));
         replacers.push(createReplacer(`^(${template})[^:\\-\\[\\]]`, selectorReplacements[key]));
         replacers.push(createReplacer(`[^:-](${template})$`, selectorReplacements[key]));
         replacers.push(createReplacer(`^(${template})$`, selectorReplacements[key]));
      }
   }

   return (string) => {
      let newString = string;

      replacers.forEach((entity) => {
         if (entity.test(newString)) {
            newString = entity.replace(newString);
         }
      });

      return newString;
   };
}

module.exports = {
   compileReplacer
};
