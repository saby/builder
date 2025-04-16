/* eslint-disable no-invalid-this */
'use strict';

const less = require('less');
const fs = require('fs-extra');
const { path } = require('../../lib/platform/path');

function genCSSWithParens(context, output) {
   if (this.parens) {
      output.add('(');
   }

   for (let i = 0; i < this.value.length; i++) {
      this.value[i].genCSS(context, output);
      if (!this.noSpacing && i + 1 < this.value.length) {
         output.add(' ');
      }
   }

   if (this.parens) {
      output.add(')');
   }
}

function setGenCSSFunction(inst) {
   const shouldSetFunction = (
      inst.parens &&
      typeof inst.genCSS === 'function' &&
      inst.genCSS.name !== genCSSWithParens.name
   );

   if (!shouldSetFunction) {
      return;
   }

   // Original function ignores parens. Change it on prototype
   const proto = Object.getPrototypeOf(inst);
   Object.defineProperty(proto, 'genCSS', {
      value: genCSSWithParens
   });
}

class LessVisitor {
   constructor(file, moduleInfo) {
      this._urlFrom = path.relative(file.dirname, file.base);
      this._urlTo = path.join('..', moduleInfo.name);
   }

   visitArray(array) {
      for (let index = 0; index < array.length; ++index) {
         this.visit(array[index]);
      }

      return array;
   }

   visit(inst) {
      if (!(inst && typeof inst.type === 'string')) {
         return inst;
      }

      setGenCSSFunction(inst);

      if (inst.type === 'Url') {
         return this.visitUrl(inst);
      }
      if (inst.type === 'Quoted' && this.inUrl) {
         return this.visitUrlQuoted(inst);
      }

      inst.accept(this);

      return inst;
   }

   visitUrl(inst) {
      this.inUrl = true;
      inst.accept(this);
      this.inUrl = false;

      return inst;
   }

   visitUrlQuoted(inst) {
      if (inst.value.indexOf(this._urlFrom) === 0) {
         inst.value = this._urlTo + inst.value.slice(this._urlFrom.length);
      }

      return inst;
   }

   process(inst) {
      return this.visit(inst);
   }
}

function processLessValue(value, file, moduleInfo) {
   return new LessVisitor(file, moduleInfo).process(value);
}

function garbageDeclarations(file, storage, moduleInfo) {
   const data = fs.readFileSync(file.path, {
      encoding: 'utf8'
   });
   const parseOptions = {

      // additional include paths
      paths: [
         path.dirname(file.path),
         moduleInfo.path,
         moduleInfo.appRoot
      ]
   };

   let error;
   less.parse(data, parseOptions, (err, root, imports, options) => {
      if (err) {
         error = err;
         return;
      }

      const rulesSet = root.rulesets();
      for (let j = 0; j < rulesSet.length; ++j) {
         const { rules } = rulesSet[j];

         for (let index = 0; index < rules.length; ++index) {
            const rule = rules[index];

            if (rule.isLineComment) {
               continue;
            }

            if (!rule.name) {
               continue;
            }

            storage[rule.name[0].value] = processLessValue(rule.value, file, moduleInfo).toCSS(options);
         }
      }
   });

   if (error) {
      throw error;
   }

   return storage;
}

module.exports = garbageDeclarations;
