'use strict';

const initTest = require('./init-test');
const { sortDeclarations } = require('../gulp/builder/generate-task/mark-theme-modules');

describe('mark theme module', () => {
   before(async() => {
      await initTest();
   });
   it('check sorting of declarations', () => {
      const firstFallback = {
         declarations: {
            '--variableA': '#AAA',
            '--variableC': '#FFF',
            '--variableB': 'blue'
         }
      };
      const secondFallback = {
         declarations: {
            '--variableC': '#FFF',
            '--variableB': 'blue',
            '--variableA': '#AAA'
         }
      };
      const sortedFirstDecl = sortDeclarations(firstFallback.declarations);
      const sortedSecondDecl = sortDeclarations(secondFallback.declarations);
      sortedFirstDecl.should.deep.equal(sortedSecondDecl);
   });
});
