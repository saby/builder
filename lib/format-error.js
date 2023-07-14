'use strict';

const MAX_SOURCE_LINE_WIDTH = 230;

function arrowLine(lineNumber, width, errorLineNumber, errorColumnNumber) {
   const lnShift = (lineNumber + 1).toString().length + 1;

   if (typeof errorColumnNumber === 'number') {
      const arrowLength = width - errorColumnNumber + 1;

      return `${' '.repeat(lnShift + errorColumnNumber - 1)}${'^'.repeat(arrowLength)}`;
   }

   return '^'.repeat(lnShift + width);
}

function trimSourceLine(line) {
   if (line.length > MAX_SOURCE_LINE_WIDTH) {
      return `${line.slice(0, MAX_SOURCE_LINE_WIDTH)} <<< TOO LONG LINE >>>`;
   }

   return line;
}

function getSourceFragment(sourceText, errorLineNumber, errorColumnNumber) {
   const lines = sourceText.split(/\r\n|\r|\n/g);
   const result = [];

   if (errorColumnNumber > MAX_SOURCE_LINE_WIDTH) {
      // Код может быть third party, еще и минифицированным.
      // Такие полотна кода не выводим. Оставляем только указание на номер строки и столбца.
      return '';
   }

   for (let i = errorLineNumber - 10; i <= errorLineNumber + 10; i++) {
      if (i < 0 || i >= lines.length) {
         continue;
      }

      result.push(trimSourceLine(`${i + 1}:${lines[i]}`));

      if (i === errorLineNumber - 1) {
         result.push(trimSourceLine(arrowLine(i, lines[i].length, errorLineNumber, errorColumnNumber)));
      }
   }

   return `\n${result.join('\n')}`;
}

function getStackFragment(error, stackStartIndex, stackEndIndex) {
   return error.stack.toString().split('\n').slice(stackStartIndex, stackEndIndex).join('\n');
}

function formatError({
   error,
   sourceText = undefined,
   title = undefined,
   stackStartIndex = 0,
   stackEndIndex = -1
}) {
   const header = typeof title === 'string' ? `${title} ` : '';

   if (typeof sourceText === 'string') {
      if (typeof error.lineNumber === 'number') {
         const fragment = getSourceFragment(sourceText, error.lineNumber, error.column);

         return `${header}${error.message} at line ${error.lineNumber}, column ${error.column}${fragment}`;
      }

      if (typeof error.index === 'number') {
         const sourceLine = sourceText.slice(
            sourceText.lastIndexOf('\n', error.index) + 1,
            sourceText.indexOf('\n', error.index)
         );

         return `${header}${error.message} >> ${sourceLine}`;
      }
   }

   let stack;
   if (error.stack) {
      stack = getStackFragment(error, stackStartIndex, stackEndIndex);
   }

   return `${header}${error.message}${stack ? `\n${stack}` : ''}`;
}

function formatEspreeError(error, sourceText, title) {
   return formatError({
      error, sourceText, title
   });
}

function formatProcessingError(error, title) {
   return formatError({
      error,
      title,
      stackStartIndex: 1,
      stackEndIndex: 6
   });
}

module.exports = {
   formatEspreeError,
   formatProcessingError,
   formatError
};
