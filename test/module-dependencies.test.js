'use strict';

const { expect } = require('chai');
const mDepsHelpers = require('../lib/moduledeps-helpers');

describe('module dependencies helpers', () => {
   it('getNodePath should return correct path', () => {
      let result = mDepsHelpers.getNodePath('MyModule/myFile.tsx', '.tsx', '.min');
      expect(result).equal('MyModule/myFile.min.js');
      result = mDepsHelpers.getNodePath('MyModule/myFile.tsx', '.tsx', '');
      expect(result).equal('MyModule/myFile.js');

      result = mDepsHelpers.getNodePath('MyModule/myFile.ts', '.ts', '.min');
      expect(result).equal('MyModule/myFile.min.js');
      result = mDepsHelpers.getNodePath('MyModule/myFile.ts', '.ts', '');
      expect(result).equal('MyModule/myFile.js');

      result = mDepsHelpers.getNodePath('MyModule/myFile.js', '.js', '.min');
      expect(result).equal('MyModule/myFile.min.js');
      result = mDepsHelpers.getNodePath('MyModule/myFile.js', '.js', '');
      expect(result).equal('MyModule/myFile.js');

      result = mDepsHelpers.getNodePath('MyModule/myFile.json', '.json', '.min');
      expect(result).equal('MyModule/myFile.json.min.js');
      result = mDepsHelpers.getNodePath('MyModule/myFile.json', '.json', '');
      expect(result).equal('MyModule/myFile.json.js');
   });
});
