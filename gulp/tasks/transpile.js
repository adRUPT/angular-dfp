/**
 * @file Gulp transpile task configuration.
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

const gulp = require('gulp');
const babel = require('gulp-babel');
const rename = require('gulp-rename');
const strip = require('gulp-strip-comments');
const header = require('gulp-header');
const fs = require('fs');

const config = require('../config').transpile;

gulp.task('transpile', ['concat'], () =>
  gulp.src(config.src)
      .pipe(babel({presets: ['es2015']}))
      .pipe(rename(path => {
        path.basename = path.basename.replace(/\.es6/g, '');
        return path;
      }))
      .pipe(strip())
      .pipe(header(fs.readFileSync('gulp/license-header.txt', 'utf8')))
      .pipe(gulp.dest(config.dest))
);
