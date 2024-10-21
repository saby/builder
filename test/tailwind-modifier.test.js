'use strict';

const { expect } = require('chai');

const modify = require('../lib/tailwind/modify');

function generateCallback(selector) {
   return (`function() {
      return function() {
         return "before ${selector} after";
      };
   }`);
}

describe('lib/tailwind/modify', () => {
   it('should inject dependency in empty array', () => {
      const selector = 'tailwind-class-selector';
      const source = `define('ModuleName', [], ${generateCallback(selector)});`;
      const info = {
         dependency: 'css!Module/tailwind',
         selectors: [selector]
      };
      const result = modify(source, info, 2021);

      expect(result).to.include(`define('ModuleName', ["${info.dependency}"]`);
   });
   it('should inject dependency in empty array 2', () => {
      const selector = 'tailwind-class-selector';
      const source = `define([], ${generateCallback(selector)});`;
      const info = {
         dependency: 'css!Module/tailwind',
         selectors: [selector]
      };
      const result = modify(source, info, 2021);

      expect(result).to.include(`define(["${info.dependency}"]`);
   });
   it('should inject dependency in non-existent array', () => {
      const selector = 'tailwind-class-selector';
      const source = `define('ModuleName', ${generateCallback(selector)});`;
      const info = {
         dependency: 'css!Module/tailwind',
         selectors: [selector]
      };
      const result = modify(source, info, 2021);

      expect(result).to.include(`define('ModuleName', ["${info.dependency}"]`);
   });
   it('should inject dependency in non-existent array 2', () => {
      const selector = 'tailwind-class-selector';
      const source = `define(${generateCallback(selector)});`;
      const info = {
         dependency: 'css!Module/tailwind',
         selectors: [selector]
      };
      const result = modify(source, info, 2021);

      expect(result).to.include(`define(["${info.dependency}"]`);
   });
   it('should ignore if dependency parameter is function', () => {
      const selector = 'tailwind-class-selector';
      const source = `define((() => ['dep'])(), ${generateCallback(selector)});`;
      const info = {
         dependency: 'css!Module/tailwind',
         selectors: [selector]
      };
      const result = modify(source, info, 2021);

      expect(result).equals(source);
   });
});
