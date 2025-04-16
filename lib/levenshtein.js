/**
 * Код скопирован из GitHub: gustf/js-levenshtein
 * @link {https://github.com/gustf/js-levenshtein/blob/master/index.js}
 */

'use strict';

function min(d0, d1, d2, bx, ay) {
   if (d0 < d1 || d2 < d1) {
      return d0 > d2 ? d2 + 1 : d0 + 1;
   }

   return bx === ay ? d1 : d1 + 1;
}

function evalDistance(str1, str2) {
   let a = str1;
   let b = str2;

   if (a === b) {
      return 0;
   }

   if (a.length > b.length) {
      [a, b] = [b, a];
   }

   let la = a.length;
   let lb = b.length;

   while (la > 0 && (a.charCodeAt(la - 1) === b.charCodeAt(lb - 1))) {
      la--;
      lb--;
   }

   let offset = 0;

   while (offset < la && (a.charCodeAt(offset) === b.charCodeAt(offset))) {
      offset++;
   }

   la -= offset;
   lb -= offset;

   if (la === 0 || lb < 3) {
      return lb;
   }

   let x = 0;
   let y;
   let d0;
   let d1;
   let d2;
   let d3;
   let dd;
   let dy;
   let ay;
   let bx0;
   let bx1;
   let bx2;
   let bx3;

   const vector = [];

   for (y = 0; y < la; y++) {
      vector.push(y + 1);
      vector.push(a.charCodeAt(offset + y));
   }

   const len = vector.length - 1;

   for (; x < lb - 3;) {
      bx0 = b.charCodeAt(offset + (d0 = x));
      bx1 = b.charCodeAt(offset + (d1 = x + 1));
      bx2 = b.charCodeAt(offset + (d2 = x + 2));
      bx3 = b.charCodeAt(offset + (d3 = x + 3));

      x += 4;
      dd = x;

      for (y = 0; y < len; y += 2) {
         dy = vector[y];
         ay = vector[y + 1];

         d0 = min(dy, d0, d1, bx0, ay);
         d1 = min(d0, d1, d2, bx1, ay);
         d2 = min(d1, d2, d3, bx2, ay);
         dd = min(d2, d3, dd, bx3, ay);

         vector[y] = dd;

         d3 = d2;
         d2 = d1;
         d1 = d0;
         d0 = dy;
      }
   }

   for (; x < lb;) {
      bx0 = b.charCodeAt(offset + (d0 = x));

      dd = ++x;

      for (y = 0; y < len; y += 2) {
         dy = vector[y];

         dd = min(dy, d0, dd, bx0, vector[y + 1]);
         vector[y] = dd;

         d0 = dy;
      }
   }

   return dd;
}

/**
 * Найти наиболее подходящее слово, используя расстояние Левенштейна.
 * @param {string} str Слово с потенциальной опечаткой.
 * @param {string[]} strings Слова-кандидаты.
 * @param {number} threshold Максимально допустимое расстояние.
 * @return {null|string} Возвращает подходящее слово, удовлетворяющее ограничению, либо null.
 */
function findMostSimilar(str, strings, threshold) {
   const distances = strings.map(evalDistance.bind(null, str));
   const minDistance = Math.min(...distances);

   if (minDistance > threshold) {
      return null;
   }

   return strings[distances.indexOf(minDistance)];
}

module.exports = findMostSimilar;
