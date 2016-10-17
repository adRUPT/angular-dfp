/**
 * @author Peter Goldsborough <peter@goldsborough.me>
 * @author Jaime González García <vintharas@google.com>
 * @license Apache
 * Copyright 2016 Google Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var googletag = googletag || {};
googletag.cmd = googletag.cmd || [];

let angularDfp = angular.module('angularDfp', []);


(function(module) {
  function dfpFormat(string) {
    const args = Array.prototype.slice.call(arguments, 1);

    return string.replace(/{(\d+)}/g, function(match, index) {
      return index < args.length ? args[index] : match;
    });
  }

  module.factory('dfpFormat', [function() {
    return dfpFormat;
  }]);
})(angularDfp);


(function(module) {
  'use strict';

  function httpErrorFactory($log) {
    function httpError(response, message) {
      $log.error(`Error (${response.status})`);
    }

    httpError.isErrorCode = function(code) {
      if (typeof code === 'number') {
        return !(code >= 200 && code < 300);
      }

      console.assert(typeof code === 'string');

      return code[0] !== '2';
    };

    return httpError;
  }

  module.factory('httpError', ['$log', httpErrorFactory]);

})(angularDfp);


(function(module) {
  class DFPDurationError extends Error {
    constructor(interval) {
      super(`Invalid interval: '${interval}'`);
    }
  }

  function parseDurationFactory(format) {
    function convertToMilliseconds(time, unit) {
      console.assert(/^(m?s|min|h)$/g.test(unit));

      if (unit === 'ms') return time;
      if (unit === 's') return time * 1000;
      if (unit === 'min') return time * 60 * 1000;

      return time * 60 * 60 * 1000;
    }

    function convert(match) {
      const time = parseInt(match[1], 10);

      if (match.length === 2) return time;

      return convertToMilliseconds(time, match[2]);
    }

    function parseDuration(interval) {
      if (typeof interval === 'number') {
        return interval;
      }

      if (typeof interval !== 'string') {
        throw new TypeError(
          format("'{0}' must be of number or string type", interval)
        );
      }

      const match = interval.match(/(\d+)(m?s|min|h)?/);

      if (!match) {
        throw new DFPDurationError(interval);
      }

      return convert(match);
    }

    return parseDuration;
  }

  module.factory('parseDuration', ['dfpFormat', parseDurationFactory]);

})(angularDfp);


(function(module) {
  function responsiveResizeFactory($interval, $timeout, $window, dfpRefresh) {
    $window = angular.element($window);

    function responsiveResize(element, slot, boundaries) {
      boundaries = boundaries || [320, 780, 1480];
      console.assert(Array.isArray(boundaries));

      const POLL_INTERVAL = 100; 

      const POLL_DURATION = 2500; 

      function queryIFrame() {
        return element.find('div iframe');
      }

      function normalizeIFrame(iframe) {
        iframe = iframe || queryIFrame();
        iframe.css('width', iframe.attr('width') + 'px');
        iframe.css('height', iframe.attr('height') + 'px');
      }

      function hideElement() {
        element.addClass('hidden');
      }

      function showElement() {
        $timeout(function() {
          element.removeClass('hidden');
        }, 1000);
      }

      function pollForChange(initial) {
        const iframe = queryIFrame();

        const change = ['width', 'height'].some(dimension => {
          return iframe.attr(dimension) !== initial[dimension];
        });

        if (change) normalizeIFrame(iframe);
      }

      function startPolling(initial) {
        const poll = $interval(() => pollForChange(initial), POLL_INTERVAL);

        $timeout(() => $interval.cancel(poll), POLL_DURATION);
      }

      function getIframeDimensions() {
        const iframe = queryIFrame();
        const dimensions = [iframe.css('width'), iframe.css('height')];

        let plain = dimensions.map(dimension => {
          return dimension ? dimension.slice(0, -2) : null;
        });

        return {width: plain[0], height: plain[1]};
      }

      function watchResize() {
        startPolling(getIframeDimensions());

        $window.on('resize', function() {
          normalizeIFrame();
        });

        showElement();
      }

      function makeResponsive(slot) {
        function determineIndex() {
          const width = $window.innerWidth;
          const last = boundaries.length - 1;

          for (let index = 0, last; index < last; ++index) {
            if (width < boundaries[index + 1]) return index;
          }

          return last;
        }

        let index = determineIndex();

        function couldGrow() {
          if (index + 1 >= boundaries.length) return false;
          if ($window.innerWidth < boundaries[index + 1]) return false;
          return true;
        }

        function couldShrink() {
          if (index - 1 < 0) return false;
          if ($window.innerWidth >= boundaries[index]) return false;
          return true;
        }

        function transition(delta) {
          console.assert(index >= 0 && index < boundaries.length);
          console.assert(delta === -1 || delta === +1);

          index += delta;
          hideElement();

          dfpRefresh(slot).then(() => { watchResize(index); });

          console.assert(index >= 0 && index < boundaries.length);
        }

        watchResize();

        return function watchListener() {
          if (couldGrow()) {
            transition(+1);
          } else if (couldShrink()) {
            transition(-1);
          }
        };
      }

      $window.on('resize', makeResponsive(element));
    }

    return responsiveResize;
  }

  module.factory('responsiveResize',
                    ['$interval', '$timeout', '$window', 'dfpRefresh',
                     responsiveResizeFactory]);

})(angularDfp);


(function(module) {
  'use strict';

  function scriptInjectorFactory($q, httpError) {
    function createScript(url) {
      const script = document.createElement('script');
      const ssl = document.location.protocol === 'https:';

      script.async = 'async';
      script.type = 'text/javascript';
      script.src = (ssl ? 'https:' : 'http:') + url;

      return script;
    }

    function promiseScript(script, url) {
      const deferred = $q.defer();

      function resolve() {
        deferred.resolve();
      }

      function reject(response) {
        response = response || {status: 400};
        httpError(response, 'loading script "{0}".', url);

        deferred.reject(response);
      }

      script.onreadystatechange = function() {
        if (this.readyState === 4) {
          if (httpError.isErrorCode(this.status)) {
            reject(this);
          } else {
            resolve();
          }
        }
      };

      script.onload = resolve;
      script.onerror = reject;

      return deferred.promise;
    }

    function injectScript(script) {
      const head = document.head || document.querySelector('head');
      head.appendChild(script);
    }

    function scriptInjector(url) {
      const script = createScript(url);
      injectScript(script);
      return promiseScript(script);
    }

    return scriptInjector;
  }

  module.factory('scriptInjector', ['$q', 'httpError', scriptInjectorFactory]);

})(angularDfp);


var googletag = googletag || {};
googletag.cmd = googletag.cmd || [];

(function(module) {
  "use strict";

  function dfpAdController() {
    const sizes = [];

    const responsiveMapping = [];

    const targetings = [];

    const exclusions = [];

    const scripts = [];

    this.isValid = function() {
      if (sizes.length === 0) return false;
      if (!this.adUnit) return false;
      return true;
    };

    this.getState = function() {
      console.assert(this.isValid());
      return Object.freeze({
        sizes: sizes,
        responsiveMapping: responsiveMapping,
        targeting: targetings,
        exclusions: exclusions,
        adUnit: this.adUnit,
        forceSafeFrame: this.forceSafeFrame,
        safeFrameConfig: this.safeFrameConfig,
        clickUrl: this.clickUrl,
        refresh: this.refresh,
        scripts: scripts,
        collapseIfEmpty: this.collapseIfEmpty
      });
    };

    this.addSize = function(size) {
      sizes.push(size);
    };

    this.addResponsiveMapping = function(mapping) {
      responsiveMapping.push(mapping);
    };

    this.addTargeting = function(targeting) {
      targetings.push(targeting);
    };

    this.addExclusion = function(exclusion) {
      exclusions.push(exclusion);
    };

    this.addScript = function(script) {
      scripts.push(script);
    };
  }

  function dfpAdDirective(scope, element, attributes, controller, $injector) {
    const dfp = $injector.get('dfp');
    const dfpIDGenerator = $injector.get('dfpIDGenerator');
    const dfpRefresh = $injector.get('dfpRefresh');
    const responsiveResize = $injector.get('responsiveResize');

    const ad = controller.getState();

    const jQueryElement = element;
    element = element[0];

    dfpIDGenerator(element);

    function addResponsiveMapping(slot) {
      if (ad.responsiveMapping.length === 0) return;

      const sizeMapping = googletag.sizeMapping();

      ad.responsiveMapping.forEach(function(mapping) {
        sizeMapping.addSize(mapping.browserSize, mapping.adSizes);
      });

      slot.defineSizeMapping(sizeMapping.build());
    }

    function defineSlot() {
      const slot = googletag.defineSlot(ad.adUnit, ad.sizes, element.id);

      if (ad.forceSafeFrame !== undefined) {
        slot.setForceSafeFrame(true);
      }

      if (ad.clickUrl) {
        slot.setClickUrl(ad.clickUrl);
      }

      if (ad.collapseIfEmpty !== undefined) {
        slot.setCollapseEmptyDiv(true, true);
      }

      if (ad.safeFrameConfig !== undefined) {
        slot.setSafeFrameConfig(JSON.parse(ad.safeFrameConfig));
      }

      addResponsiveMapping(slot);

      ad.targeting.forEach(targeting => {
        slot.setTargeting(targeting.key, targeting.values);
      });

      ad.exclusions.forEach(exclusion => {
        slot.setCategoryExclusion(exclusion);
      });

      ad.scripts.forEach(script => { script(slot); });

      slot.addService(googletag.pubads());

      googletag.display(element.id);

      dfpRefresh(slot, ad.refresh).then(() => {
        if (ad.responsiveMapping.length > 0) {
          responsiveResize(jQueryElement);
        }
      });
    }

    dfp.then(defineSlot);
  }

  module.directive('dfpAd', ['$injector', function($injector) {
    return {
      restrict: 'AE',
      controller: dfpAdController,
      controllerAs: 'controller',
      bindToController: true,
      link: function() {
        const args = Array.prototype.slice.call(arguments, 0, 4);
        dfpAdDirective.apply(null, args.concat($injector));
      },
      scope: {
        adUnit: '@',
        clickUrl: '@',
        forceSafeFrame: '@',
        safeFrameConfig: '@',
        refresh: '@',
        collapseIfEmpty: '@'
      }
    };
  }
  ]);

})(angularDfp);


(function(module) {
  function dfpAudiencePixelDirective(scope, element, attributes) {
    const axel = String(Math.random());
    const random = axel * 10000000000000;

    let adUnit = '';
    if (scope.adUnit) {
      adUnit = `dc_iu=${scope.adUnit}`;
    }

    let ppid = '';
    if (scope.ppid) {
      ppid = `ppid=${scope.ppid}`;
    }

    const pixel = document.createElement('img');

    pixel.src = 'https://pubads.g.doubleclick.net/activity;ord=';
    pixel.src += `${random};dc_seg=${scope.segmentId};${adUnit}${ppid}`;

    pixel.width = 1;
    pixel.height = 1;
    pixel.border = 0;
    pixel.style.visibility = 'hidden';

    element.append(pixel);
  }

  module.directive('dfpAudiencePixel', [() => {
    return {
      restrict: 'E',
      scope: {adUnit: '@', segmentId: '@', ppid: '@'},
      link: dfpAudiencePixelDirective
    };
  }]);

})(angularDfp);


(function(module) {
  function dfpExclusionDirective(scope, element, attributes, ad) {
    ad.addExclusion(element.html());
  }

  module.directive('dfpExclusion', [function() {
    return {
      restrict: 'E',
      require: '^^dfpAd',
      link: dfpExclusionDirective
    };
  }]);

})(angularDfp);


(function(module) {
  function dfpIDGeneratorFactory() {
    const generatedIDs = {};

    function generateID() {
      let id = null;

      do {
        const number = Math.random().toString().slice(2);
        id = 'gpt-ad-' + number;
      } while (id in generatedIDs);

      generatedIDs[id] = true;

      return id;
    }

    function dfpIDGenerator(element) {
      if (element && element.id && !(element.id in generatedIDs)) {
        return element.id;
      }

      const id = generateID();
      if (element) element.id = id;

      return id;
    }

    dfpIDGenerator.isTaken = function(id) {
      return id in generatedIDs;
    };

    dfpIDGenerator.isUnique = function(id) {
      return !dfpIDGenerator.isTaken(id);
    };

    return dfpIDGenerator;
  }

  module.factory('dfpIDGenerator', [dfpIDGeneratorFactory]);

})(angularDfp);


var googletag = googletag || {};
googletag.cmd = googletag.cmd || [];

(function(module) {
  class DFPRefreshError extends Error {}

  function dfpRefreshProvider() {
    const self = this;

    self.bufferInterval = 1000;

    self.bufferBarrier = null;

    self.oneShotBarrier = true;

    self.refreshInterval = 60 * 60 * 1000; 

    self.priority = {
      REFRESH: 1,
      INTERVAL: 1,
      BARRIER: 1
    };

    self.$get = [
      '$rootScope',
      '$interval',
      '$q',
      'parseDuration',
      function($rootScope, $interval, $q, parseDuration) {
        const Options = Object.freeze({
          REFRESH: 'REFRESH',
          INTERVAL: 'INTERVAL',
          BARRIER: 'BARRIER'
        });

        dfpRefresh.Options = Options;

        let buffer = [];

        const intervals = {refresh: null, buffer: null};

        const isEnabled = Object.seal({
          refresh: self.refreshInterval !== null,
          interval: self.bufferInterval !== null,
          barrier: self.bufferBarrier !== null
        });

        function dfpRefresh(slot, interval, defer) {
          const deferred = $q.defer();
          const task = {slot: slot, deferred: deferred};

          if (interval) {
            addSlotInterval(task, interval);
          }

          if (!interval || !defer) {
            scheduleRefresh(task);
          }

          return deferred.promise;
        }

        dfpRefresh.cancelInterval = function(slot) {
          if (!dfpRefresh.hasSlotInterval(slot)) {
            throw new DFPRefreshError("No interval for given slot");
          }

          $interval.cancel(intervals[slot]);
          delete intervals[slot];

          return dfpRefresh;
        };

        dfpRefresh.hasSlotInterval = function(slot) {
          return slot in self.intervals;
        };

        dfpRefresh.setBufferInterval = function(interval) {
          self.bufferInterval = parseDuration(interval);
          prioritize();

          return dfpRefresh;
        };

        dfpRefresh.clearBufferInterval = function() {
          if (!dfpRefresh.hasBufferInterval()) {
            console.warn("clearBufferInterval had no " +
                         "effect because no interval was set.");
            return dfpRefresh;
          }

          disableBufferInterval();
          self.bufferInterval = null;

          prioritize();

          return dfpRefresh;
        };

        dfpRefresh.hasBufferInterval = function() {
          return self.bufferInterval !== null;
        };

        dfpRefresh.bufferIntervalIsEnabled = function() {
          return isEnabled.interval;
        };

        dfpRefresh.getBufferInterval = function() {
          return self.bufferInterval;
        };

        dfpRefresh.setBufferBarrier = function(numberOfAds, oneShot) {
          self.bufferBarrier = numberOfAds;
          self.oneShotBarrier = (oneShot === undefined) ? true : oneShot;
          prioritize();

          return dfpRefresh;
        };

        dfpRefresh.clearBufferBarrier = function() {
          if (!dfpRefresh.hasBufferBarrier()) {
            console.warn("clearBufferBarrier had not effect because " +
                         "no barrier was set.");
            return dfpRefresh;
          }

          self.bufferBarrier = null;
          prioritize();

          return dfpRefresh;
        };

        dfpRefresh.getBufferBarrier = function() {
          return self.bufferBarrier;
        };

        dfpRefresh.hasBufferBarrier = function() {
          return self.bufferBarrier !== null;
        };

        dfpRefresh.bufferBarrierIsEnabled = function() {
          return isEnabled.barrier;
        };

        dfpRefresh.bufferBarrierIsOneShot = function() {
          return self.oneShotBarrier;
        };

        dfpRefresh.setRefreshInterval = function(interval) {
          self.refreshInterval = parseDuration(interval);
          enableRefreshInterval();
          prioritize();

          return dfpRefresh;
        };

        dfpRefresh.hasRefreshInterval = function() {
          return self.refreshInterval !== null;
        };

        dfpRefresh.refreshIntervalIsEnabled = function() {
          return isEnabled.refresh;
        };

        dfpRefresh.clearRefreshInterval = function() {
          if (!dfpRefresh.hasRefreshInterval()) {
            console.warn("clearRefreshInterval had no effect because " +
                         "no refresh interval was set.");
          }

          disableRefreshInterval();
          prioritize();

          return dfpRefresh;
        };

        dfpRefresh.getRefreshInterval = function() {
          return self.refreshInterval;
        };

        dfpRefresh.isBuffering = function() {
          return [Options.BARRIER, Options.INTERVAL].some(dfpRefresh.isEnabled);
        };

        dfpRefresh.has = function(option) {
          switch (option) {
            case Options.REFRESH: return dfpRefresh.hasRefreshInterval();
            case Options.INTERVAL: return dfpRefresh.hasBufferInterval();
            case Options.BARRIER: return dfpRefresh.hasBufferBarrier();
            default: throw new DFPRefreshError(`Invalid option '${option}'`);
          }
        };

        dfpRefresh.isEnabled = function(option) {
          ensureValidOption(option);
          return isEnabled[option];
        };

        dfpRefresh.setPriority = function(option, priority) {
          ensureValidOption(option);
          ensureValidPriority(priority);
          self.priority[option] = priority;

          return dfpRefresh;
        };

        dfpRefresh.getPriority = function(option) {
          ensureValidOption(option);
          return self.priority[option];
        };

        dfpRefresh.setRefreshPriority = function(priority) {
          dfpRefresh.setPriority('refresh');
        };

        dfpRefresh.getRefreshPriority = function() {
          return dfpRefresh.getPriority('refresh');
        };

        dfpRefresh.setBarrierPriority = function(priority) {
          dfpRefresh.setPriority('barrier');
        };

        dfpRefresh.getBarrierPriority = function() {
          return dfpRefresh.getPriority('barrier');
        };

        dfpRefresh.setIntervalPriority = function(priority) {
          ensureValidPriority(priority);
          dfpRefresh.setPriority('interval');
        };

        dfpRefresh.getIntervalPriority = function() {
          return dfpRefresh.getPriority('interval');
        };

        function ensureValidOption(option) {
          if (!(option in Options)) {
            throw new DFPRefreshError(`Invalid option '${option}'`);
          }
        }

        function ensureValidPriority(priority) {
          if (typeof priority !== `number`) {
            throw new DFPRefreshError(`Priority '${priority}' is not a number`);
          }
        }

        function enable(option, yes) {
          if (yes === false) {
            disable(option);
            return;
          }

          switch (option) {
            case Options.REFRESH: enableRefreshInterval(); break;
            case Options.INTERVAL: enableBufferInterval(); break;
            case Options.BARRIER: enableBufferBarrier(); break;
            default: console.assert(false);
          }
        }

        function disable(option) {
          switch (option) {
            case Options.REFRESH: disableRefreshInterval(); break;
            case Options.INTERVAL: disableBufferInterval(); break;
            case Options.BARRIER: disableBufferBarrier(); break;
            default: console.assert(false);
          }
        }

        function prioritize() {
          let options = Object.keys(Options);

          let available = options.filter(dfpRefresh.has);

          let priorities = available.map(option => self.priority[option]);

          let maximum = priorities.reduce((a, b) => Math.max(a, b));

          for (let index = 0; index < available.length; ++index) {
            if (priorities[index] === maximum) {
              enable(available[index]);
            } else {
              disable(available[index]);
            }
          }
        }

        function refresh(tasks) {
          console.assert(tasks === undefined || tasks !== null);

          if (tasks === undefined) {
            googletag.pubads().refresh();
            return;
          }

          if (tasks.length === 0) return;

          tasks = tasks.filter(pair => pair.slot !== null);

          googletag.cmd.push(() => {
            googletag.pubads().refresh(tasks.map(task => task.slot));
            tasks.forEach(task => task.deferred.resolve());
          });
        }

        function flushBuffer() {
          refresh(buffer);
          buffer = [];
        }

        function enableRefreshInterval() {
          console.assert(dfpRefresh.hasRefreshInterval());

          const task = function() {
            buffer.fill(null);

            refresh();
          };

          const promise = $interval(task, self.refreshInterval);
          intervals.refresh = promise;
          isEnabled.refresh = true;
        }

        function disableRefreshInterval() {
          if (isEnabled.refresh) {
            $interval.cancel(intervals.refresh);
            intervals.refresh = null;
            isEnabled.refresh = false;
          }
        }

        function enableBufferInterval() {
          console.assert(dfpRefresh.hasBufferInterval());

          const task = function() {
            refresh(buffer);
            buffer.fill(null);
          };

          const promise = $interval(task, self.bufferInterval);
          intervals.buffer = promise;
          isEnabled.interval = true;
        }

        function disableBufferInterval() {
          if (isEnabled.interval) {
            $interval.cancel(intervals.buffer);
            intervals.buffer = null;
            isEnabled.interval = false;
          }
        }

        function enableBufferBarrier() {
          console.assert(dfpRefresh.hasBufferBarrier());
          isEnabled.barrier = true;
        }

        function disableBufferBarrier() {
          isEnabled.barrier = false;
        }

        function addSlotInterval(task, interval) {
          interval = parseDuration(interval);
          const promise = $interval(() => { scheduleRefresh(task); }, interval);
          intervals[task.slot] = promise;
        }

        function scheduleRefresh(task) {
          if (dfpRefresh.isBuffering()) {
            bufferRefresh(task);
          } else {
            refresh([task]);
          }
        }

        function bufferRefresh(task) {
          buffer.push(task);

          if (!isEnabled[Options.BARRIER]) return;
          if (buffer.length === self.bufferBarrier) {
            flushBuffer();
            if (self.oneShotBarrier) {
              dfpRefresh.clearBufferBarrier();
            }
          }
        }

        $rootScope.$on('$destroy', function() {
          intervals.forEach(promise => {
            $interval.cancel(promise);
          });
        });

        prioritize();

        return dfpRefresh;
      }];
  }

  module.provider('dfpRefresh', [dfpRefreshProvider]);
})(angularDfp);


(function(module) {
  function DFPResponsiveController() {
    const browserSize = Object.seal([
      this.browserWidth,
      this.browserHeight || 0
    ]);

    const adSizes = [];

    function isValid() {
      if (browserSize.some(value => typeof value !== 'number')) return false;
      return adSizes.length > 0;
    }

    this.addSize = function(size) {
      adSizes.push(size);
    };

    this.getState = function() {
      console.assert(isValid());
      return Object.freeze({
        browserSize: browserSize,
        adSizes: adSizes
      });
    };
  }

  function dfpResponsiveDirective(scope, element, attributes, ad) {
    const mapping = scope.controller.getState();
    ad.addResponsiveMapping(mapping);
  }

  module.directive('dfpResponsive', [function() {
    return {
      restrict: 'E',
      require: '^^dfpAd',
      controller: DFPResponsiveController,
      controllerAs: 'controller',
      bindToController: true,
      link: dfpResponsiveDirective,
      scope: {browserWidth: '=', browserHeight: '='}
    };
  }]);

})(angularDfp);


(function(module) {
  function dfpScriptDirective(scope, element, attributes, ad, $injector) {
    const format = $injector.get('dfpFormat');
    const script = format(
       '(function(scope, {0}) { {1} })',
       scope.slotAs || 'slot',
       element.html().trim()
     );

    ad.addScript(eval(script).bind(null, scope.scope));
  }

  module.directive('dfpScript', ['$injector', function($injector) {
    return {
      restrict: 'E',
      require: '^^dfpAd',
      scope: {slotAs: '@', scope: '='},
      link: function() {
        const args = Array.prototype.slice.call(arguments, 0, 4);
        dfpScriptDirective.apply(null, args.concat($injector));
      }
    };
  }]);

})(angularDfp);


(function(module) {
  function DFPSizeDirective(scope, element, attributes, parent) {
    parent = parent[1] || parent[0];

    console.assert(parent);

    if (scope.width && scope.height) {
      parent.addSize([scope.width, scope.height]);
    } else {
      parent.addSize(element[0].innerHTML);
    }
  }

  module.directive('dfpSize', [function() {
    return {
      restrict: 'E',
      require: ['?^^dfpAd', '?^^dfpResponsive'],
      scope: {width: '=', height: '='},
      link: DFPSizeDirective
    };
  }]);

})(angularDfp);


(function(module) {
  function dfpTargetingController() {
    const values = this.value ? [this.value] : [];

    this.isValid = function() {
      if (!('key' in this)) return false;
      if (values.length === 0) return false;
      return true;
    };

    this.getState = function() {
      console.assert(this.isValid());
      return Object.freeze({
        key: this.key,
        values: values
      });
    };

    this.addValue = function(value) {
      values.push(value);
    };
  }

  function dfpTargetingDirective(scope, element, attributes, ad) {
    console.assert(ad !== undefined);

    const targeting = scope.controller.getState();
    ad.addTargeting(targeting);
  }

  module.directive('dfpTargeting', [function() {
    return {
      restrict: 'E',
      require: '^^dfpAd', 
      controller: dfpTargetingController,
      controllerAs: 'controller',
      bindToController: true,
      scope: {key: '@', value: '@'},
      link: dfpTargetingDirective
    };
  }]);

})(angularDfp);


(function(module) {
  function dfpValueDirective(scope, element, attributes, parent) {
    parent.addValue(element.html());
  }

  module.directive('dfpValue', [function() {
    return {
      restrict: 'E',
      require: '^^dfpTargeting',
      link: dfpValueDirective
    };
  }]);
})(angularDfp);


let angularDfpVideo = angular.module('angularDfp');

(function(module) {
  function dfpVideoDirective(scope, element, attributes, $injector) {
    const dfpIDGenerator = $injector.get('dfpIDGenerator');

    element = element[0];

    dfpIDGenerator(element, true);

    const player = videojs(element.id);

    player.ima({id: element.id, adTagUrl: scope.adTag});
    player.ima.requestAds();
    player.ima.initializeAdDisplayContainer();
  }

  module.directive('dfpVideo', ['$injector', function($injector) {
    return {
      restrict: 'AE',
      scope: {adTag: '@'},
      link: function() {
        const args = Array.prototype.slice.call(arguments, 0, 4);
        dfpVideoDirective.apply(null, args.concat($injector));
      }
    };
  }]);

  return module;

})(angularDfpVideo);


var googletag = googletag || {};
googletag.cmd = googletag.cmd || [];

(function(module) {
  "use strict";

  class DFPConfigurationError extends Error {}

  module.constant(
    'GPT_LIBRARY_URL',
    '//www.googletagservices.com/tag/js/gpt.js'
  );

  function dfpProvider(GPT_LIBRARY_URL) {
    const self = this;

    self.enableSingleRequestArchitecture = true;

    self.enableVideoAds = true;

    self.collapseIfEmpty = true;

    self.disableInitialLoad = true;

    self.enableSyncRendering = false;

    self.centering = false;

    self.location = null;

    self.ppid = null;

    self.globalTargeting = null;

    self.forceSafeFrame = false;

    self.safeFrameConfig = null;

    self.loadGPT = true;

    let loaded = false;

    function addSafeFrameConfig(pubads) {
      if (!self.safeFrameConfig) return;
      if (typeof self.globalTargeting !== 'object') {
        throw new DFPConfigurationError('Targeting must be an object');
      }
      pubads.setSafeFrameConfig(self.safeFrameConfig);
    }

    function addTargeting(pubads) {
      if (!self.globalTargeting) return;
      if (typeof self.globalTargeting !== 'object') {
        throw new DFPConfigurationError('Targeting must be an object');
      }

      for (let key in self.globalTargeting) {
        if (self.globalTargeting.hasOwnProperty(key)) {
          pubads.setTargeting(key, self.globalTargeting[key]);
        }
      }
    }

    function addLocation(pubads) {
      if (!self.location) return;

      if (typeof self.location === 'string') {
        pubads.setLocation(self.location);
        return;
      }

      if (!Array.isArray(self.location)) {
        throw new DFPConfigurationError('Location must be an ' +
        'array or string');
      }

      pubads.setLocation.apply(pubads, self.location);
    }

    function addPPID(pubads) {
      if (!self.ppid) return;
      if (typeof self.ppid !== 'string') {
        throw new DFPConfigurationError('PPID must be a string');
      }

      pubads.setPublisherProvidedId(self.ppid);
    }

    this.$get = ['scriptInjector', scriptInjector => {
      function setup() {
        const pubads = googletag.pubads();

        if (self.enableSingleRequestArchitecture) {
          pubads.enableSingleRequest();
        }

        if (self.enableVideoAds) {
          pubads.enableVideoAds();
        }

        if (self.collapseIfEmpty) {
          pubads.collapseEmptyDivs();
        }

        if (self.disableInitialLoad) {
          pubads.disableInitialLoad();
        }

        if (self.enableSyncRendering) {
          pubads.enableSyncRendering();
        }

        pubads.setForceSafeFrame(self.forceSafeFrame);
        pubads.setCentering(self.centering);

        addLocation(pubads);
        addPPID(pubads);
        addTargeting(pubads);
        addSafeFrameConfig(pubads);

        googletag.enableServices();
      }

      function dfp() {
        googletag.cmd.push(setup);

        if (self.loadGPT) {
          scriptInjector(GPT_LIBRARY_URL).then(() => {
            loaded = true;
          });
        }
      }

      dfp.hasLoaded = function() {
        return loaded;
      };

      dfp.then = function(task) {
        googletag.cmd.push(task);
      };

      return dfp;
    }];
  }

  module.provider('dfp', ['GPT_LIBRARY_URL', dfpProvider]);

})(angularDfp);