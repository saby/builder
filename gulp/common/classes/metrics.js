'use strict';

const TimeReporter = require('./time-reporter');
const getBuildStatusStorage = require('./build-status');

function createFeatures(taskParameters) {
   const features = new Set();

   if (taskParameters.cache.hasIncompatibleChanges || taskParameters.cache.isFirstBuild()) {
      features.add('full_build');
   } else {
      features.add('incremental_build');
   }

   if (taskParameters.cache.dropCacheForOldMarkup) {
      features.add('drop_cache.xhtml');
   }
   if (taskParameters.cache.dropCacheForMarkup) {
      features.add('drop_cache.wml_tmpl');
   }
   if (taskParameters.cache.dropCacheForStaticMarkup) {
      features.add('drop_cache.html.tmpl');
   }
   if (taskParameters.cache.dropCacheForLess) {
      features.add('drop_cache.less');
   }
   if (taskParameters.config.dropCacheForIcons) {
      features.add('drop_cache.icons');
   }
   if (taskParameters.config.dropCacheForTsc) {
      features.add('drop_cache.typescript');
   }

   return Array.from(features);
}

class Metrics {
   constructor(modulesInfo) {
      this.timeReporter = new TimeReporter();
      this.features = new Set();

      getBuildStatusStorage().init(modulesInfo);
   }

   addFeature(feature) {
      this.features.add(feature);
   }

   createTimer(taskName) {
      return this.timeReporter.createTimer(taskName);
   }

   storeTaskTime(taskName, startTime) {
      this.timeReporter.storeTaskTime(taskName, startTime);
   }

   storePluginTime(pluginName, startTime) {
      this.timeReporter.storePluginTime(pluginName, startTime);
   }

   storeWorkerTime(pluginName, timestamp) {
      this.timeReporter.storeWorkerTime(pluginName, timestamp);
   }

   getTimeReport() {
      return this.timeReporter.getTimeReport();
   }

   getTimeMetrics(taskParameters) {
      const metrics = this.timeReporter.getTimeMetrics();

      return {
         features: createFeatures(taskParameters),
         metrics
      };
   }
}

module.exports = Metrics;
