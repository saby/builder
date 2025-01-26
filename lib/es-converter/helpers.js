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

function calculateLocation(text, fragment) {
   const lines = text.replace(/\n\r/gi, '\n').split('\n');
   const lineIndex = lines.findIndex(line => line.includes(fragment));
   const columnIndex = lines[lineIndex].indexOf(fragment);

   return {
      line: lineIndex + 1,
      column: columnIndex
   };
}

module.exports = {
   hoistTopComment,
   calculateLocation
};
