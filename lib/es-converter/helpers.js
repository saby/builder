'use strict';

function findComment(string) {
   const match = /\/\*+\s+\*\s+@jest-environment\s+(jsdom|node)\s+\*\/\s+/gm.exec(string);

   if (!match) {
      return [0, 0];
   }

   return [match.index, match.index + match[0].length];
}

function hoistTopComment(inputText, outputText) {
   const inputComment = findComment(inputText);
   const outputComment = findComment(outputText);

   const comment = `${inputText.slice(inputComment[0], inputComment[1])}`;
   return comment + outputText.slice(0, outputComment[0]) + outputText.slice(outputComment[1]);
}

module.exports = {
   hoistTopComment
};
