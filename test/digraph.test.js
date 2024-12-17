'use strict';

const { expect } = require('chai');

const Digraph = require('../lib/struct/digraph');

const edges = [
   [1, []],
   [2, []],
   [3, [2]],
   [4, [3]],
   [5, [1, 2]],
   [6, [2, 3]],
   [7, [3, 4, 6]],
   [8, []],
   [9, [4, 8]],
   [10, [4, 7]],
   [11, [6]],
   [12, [5, 11]],
   [13, [11]],
   [14, [7, 10]],
   [15, [10, 14]],
   [16, [11, 12, 13]],
   [17, [6, 13, 14, 16]],
   [18, [14, 15, 17, 19]],
   [19, [15]]
];
const reachableVertexes = [
   [1, []],
   [2, []],
   [3, [2]],
   [4, [2, 3]],
   [5, [1, 2]],
   [6, [2, 3]],
   [7, [2, 3, 4, 6]],
   [8, []],
   [9, [2, 3, 4, 8]],
   [10, [2, 3, 4, 6, 7]],
   [11, [2, 3, 6]],
   [12, [1, 2, 3, 5, 6, 11]],
   [13, [2, 3, 6, 11]],
   [14, [2, 3, 4, 6, 7, 10]],
   [15, [2, 3, 4, 6, 7, 10, 14]],
   [16, [1, 2, 3, 5, 6, 11, 12, 13]],
   [17, [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 16]],
   [18, [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 19]],
   [19, [2, 3, 4, 6, 7, 10, 14, 15]]
];

describe('lib/struct/digraph', () => {
   /** @type {Digraph} */
   let graph;

   beforeEach(() => {
      graph = new Digraph();

      edges.forEach(([vertex, children]) => graph.put(vertex, children));
   });

   it('should have lost vertexes', () => {
      graph.put(0, [404]);

      expect(graph.testLostVertexes()).deep.equal([[404, [0]]]);
   });

   it('should not have lost vertexes', () => {
      expect(graph.testLostVertexes()).deep.equal([]);
   });

   describe('should return all reachable vertexes', () => {
      const intSorter = (a, b) => Math.sign(a - b);

      reachableVertexes.forEach(([vertex, expected]) => {
         it(`for vertex "${vertex}"`, () => {
            expect(graph.getDeep(vertex).sort(intSorter)).deep.equal(expected);
         });
      });
   });

   it('should fail with cycle getting deep vertexes', () => {
      graph.modify(1, [17]);

      expect(() => graph.getDeep(1))
         .throws('Cannot access node due to cycle: 1 -> 17 -> 16 -> 12 -> 5 -> 1');
   });

   it('should have cycles in graph', () => {
      graph.modify(1, [17]);

      expect(graph.testCycles()).deep.equal([
         [1, 17, 16, 12, 5, 1]
      ]);
   });

   it('should have cycles in graph 2', () => {
      graph.modify(2, [17]);

      expect(graph.testCycles()).deep.equal([
         [2, 17, 6, 2],
         [2, 17, 6, 3, 2],
         [2, 17, 16, 12, 5, 2],
         [2, 17, 16, 12, 11, 6, 2],
         [2, 17, 16, 12, 11, 6, 3, 2]
      ]);
   });
});
