(function () {var bundleExports = {};
define('Modul/lazy-private.package.min',['wml!Modul/private','require'],function(wml_Modul_private,require) {
var Modul_private;
Object.defineProperty(bundleExports, 'Modul/private', {get: function() {if (!Modul_private) {Modul_private = {};var result = function(e,l){return{_moduleName:'Modul/private',externalDeps:{module1:e},template:l};}(InterfaceModule1_amdModule,wml_Modul_private,InterfaceModule2_amdModule);if (result) {Modul_private = result;}}return Modul_private;},enumerable: true});
var InterfaceModule2_amdModule;
Object.defineProperty(bundleExports, 'InterfaceModule2/amdModule', {get: function() {if (!InterfaceModule2_amdModule) {InterfaceModule2_amdModule = {};var result = function(){return{_moduleName:'InterfaceModule1/amdModule'};}(null);if (result) {InterfaceModule2_amdModule = result;}}return InterfaceModule2_amdModule;},enumerable: true});
var InterfaceModule1_library;
Object.defineProperty(bundleExports, 'InterfaceModule1/library', {get: function() {if (!InterfaceModule1_library) {InterfaceModule1_library = {};var result = function(e,t){Object.defineProperty(t,'__esModule',{value:true}),t['InterfaceModule1/_private/module1']=true;var r=function(e,t){'use strict';Object.defineProperty(t,'__esModule',{value:true});var r=function(){function e(e){this.variables=e;}return e;}();return t.default=r,t;}(e,{}),u=r;t['InterfaceModule1/_private/module2']=true;var n=function(e,t){'use strict';Object.defineProperty(t,'__esModule',{value:true});var r=function(){function e(e){this.variables=e;}return e;}();return t.default=r,t;}(e,{}),o=n;function i(){return'test';}return t.test=t.Module2=t.Module1=void 0,Object.defineProperty(t,'Module1',{enumerable:true,get:function(){return u.default;}}),Object.defineProperty(t,'Module2',{enumerable:true,get:function(){return o.default;}}),t.test=i,t;}(require,InterfaceModule1_library);if (result) {InterfaceModule1_library = result;}}return InterfaceModule1_library;},enumerable: true});
var InterfaceModule1_amdModule;
Object.defineProperty(bundleExports, 'InterfaceModule1/amdModule', {get: function() {if (!InterfaceModule1_amdModule) {InterfaceModule1_amdModule = {};var result = function(){return{_moduleName:'InterfaceModule1/amdModule'};}(null);if (result) {InterfaceModule1_amdModule = result;}}return InterfaceModule1_amdModule;},enumerable: true});
var InterfaceModule1__private_module2;
Object.defineProperty(bundleExports, 'InterfaceModule1/_private/module2', {get: function() {if (!InterfaceModule1__private_module2) {InterfaceModule1__private_module2 = {};var result = function(e,t){'use strict';Object.defineProperty(t,'__esModule',{value:true});var r=function(e){this.variables=e;};t.default=r;}(require,InterfaceModule1__private_module2);if (result) {InterfaceModule1__private_module2 = result;}}return InterfaceModule1__private_module2;},enumerable: true});
var InterfaceModule1__private_module1;
Object.defineProperty(bundleExports, 'InterfaceModule1/_private/module1', {get: function() {if (!InterfaceModule1__private_module1) {InterfaceModule1__private_module1 = {};var result = function(e,t){'use strict';Object.defineProperty(t,'__esModule',{value:true});var r=function(e){this.variables=e;};t.default=r;}(require,InterfaceModule1__private_module1);if (result) {InterfaceModule1__private_module1 = result;}}return InterfaceModule1__private_module1;},enumerable: true});
});

(function(){define('css!InterfaceModule2/moduleStyle',['css!Modul/lazy-private.package'],'');define('css!InterfaceModule1/moduleStyle',['css!Modul/lazy-private.package'],'');define('css!InterfaceModule1/amdModule',['css!Modul/lazy-private.package'],'');})();
define('Modul/private',['Modul/lazy-private.package.min'], function() {return bundleExports['Modul/private'];});
define('InterfaceModule2/amdModule',['css!InterfaceModule2/amdModule','Modul/lazy-private.package.min'],  function() {return bundleExports['InterfaceModule2/amdModule'];});
define('InterfaceModule1/library',['Modul/lazy-private.package.min'], function() {return bundleExports['InterfaceModule1/library'];});
define('InterfaceModule1/amdModule',['css!InterfaceModule1/amdModule','Modul/lazy-private.package.min'],  function() {return bundleExports['InterfaceModule1/amdModule'];});
define('InterfaceModule1/_private/module2',['Modul/lazy-private.package.min'], function() {return bundleExports['InterfaceModule1/_private/module2'];});
define('InterfaceModule1/_private/module1',['Modul/lazy-private.package.min'], function() {return bundleExports['InterfaceModule1/_private/module1'];});
})();