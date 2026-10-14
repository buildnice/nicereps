PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE setting (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
INSERT INTO setting VALUES('weekStart','sunday');
CREATE TABLE exercise (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL UNIQUE, mode TEXT NOT NULL DEFAULT 'reps' CHECK (mode IN ('reps', 'duration', 'distance', 'interval', 'check')), rest INTEGER NOT NULL DEFAULT 120, source TEXT);
INSERT INTO exercise VALUES('qqby4op48zaekyfedo1rci50','Romanian Deadlift','reps',120,'Romanian_Deadlift');
INSERT INTO exercise VALUES('lshtvwyw2kca4ag2arrejp82','Bench Press','reps',120,NULL);
INSERT INTO exercise VALUES('e1t15cjw23pfser1gfo7bumq','Overhead Press','reps',120,NULL);
INSERT INTO exercise VALUES('z9u6xleh70vwaos4681rib93','Cable Fly','reps',120,NULL);
INSERT INTO exercise VALUES('lttalch1kn0hg0s6pvr2sh0m','Barbell Row','reps',120,NULL);
INSERT INTO exercise VALUES('bvviauhoyyshk6rvn56qoj9a','Pull-up','reps',120,NULL);
INSERT INTO exercise VALUES('ia978dj5361so8xhc2xgken6','Back Squat','reps',120,NULL);
INSERT INTO exercise VALUES('vlw1jjljv7tz6ahjzmmms789','Run','distance',120,NULL);
INSERT INTO exercise VALUES('m37c6gfp0ydtrvpq5416322l','Bike Sprints','interval',120,NULL);
INSERT INTO exercise VALUES('bi9actis3qk9i76iim927qgx','Mobility Flow','check',120,NULL);
CREATE TABLE exercise_muscle (
      exercise_id TEXT NOT NULL REFERENCES exercise(id) ON DELETE CASCADE,
      muscle TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
      PRIMARY KEY (exercise_id, muscle));
INSERT INTO exercise_muscle VALUES('lshtvwyw2kca4ag2arrejp82','chest','primary');
INSERT INTO exercise_muscle VALUES('lshtvwyw2kca4ag2arrejp82','shoulders','secondary');
INSERT INTO exercise_muscle VALUES('lshtvwyw2kca4ag2arrejp82','triceps','secondary');
INSERT INTO exercise_muscle VALUES('e1t15cjw23pfser1gfo7bumq','shoulders','primary');
INSERT INTO exercise_muscle VALUES('e1t15cjw23pfser1gfo7bumq','triceps','secondary');
INSERT INTO exercise_muscle VALUES('z9u6xleh70vwaos4681rib93','chest','primary');
INSERT INTO exercise_muscle VALUES('lttalch1kn0hg0s6pvr2sh0m','back','primary');
INSERT INTO exercise_muscle VALUES('lttalch1kn0hg0s6pvr2sh0m','biceps','secondary');
INSERT INTO exercise_muscle VALUES('bvviauhoyyshk6rvn56qoj9a','back','primary');
INSERT INTO exercise_muscle VALUES('bvviauhoyyshk6rvn56qoj9a','biceps','secondary');
INSERT INTO exercise_muscle VALUES('ia978dj5361so8xhc2xgken6','quads','primary');
INSERT INTO exercise_muscle VALUES('ia978dj5361so8xhc2xgken6','glutes','secondary');
INSERT INTO exercise_muscle VALUES('qqby4op48zaekyfedo1rci50','hamstrings','primary');
INSERT INTO exercise_muscle VALUES('qqby4op48zaekyfedo1rci50','back','secondary');
INSERT INTO exercise_muscle VALUES('qqby4op48zaekyfedo1rci50','glutes','secondary');
INSERT INTO exercise_muscle VALUES('vlw1jjljv7tz6ahjzmmms789','quads','primary');
INSERT INTO exercise_muscle VALUES('m37c6gfp0ydtrvpq5416322l','quads','primary');
CREATE TABLE template (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL);
INSERT INTO template VALUES('d6loy6ghuzk5qtcwkmnf6na0','Push A');
INSERT INTO template VALUES('dccpwum0gyrtyfykg4h1blqb','Pull B');
INSERT INTO template VALUES('fjkezhhvwdme7blzvun90vkr','Legs');
CREATE TABLE template_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT NOT NULL REFERENCES template(id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      position INTEGER NOT NULL, superset TEXT);
INSERT INTO template_exercise VALUES('wui0p8mdjs5289o08ecfc2ce','d6loy6ghuzk5qtcwkmnf6na0','lshtvwyw2kca4ag2arrejp82',0,NULL);
INSERT INTO template_exercise VALUES('mhw4byoj9n1nwzhq6r1d0y91','d6loy6ghuzk5qtcwkmnf6na0','e1t15cjw23pfser1gfo7bumq',1,NULL);
INSERT INTO template_exercise VALUES('fojmnkhxorxiuxiaprgdyiq2','d6loy6ghuzk5qtcwkmnf6na0','z9u6xleh70vwaos4681rib93',2,NULL);
INSERT INTO template_exercise VALUES('ghcay4xzntuga0orckq9q888','dccpwum0gyrtyfykg4h1blqb','lttalch1kn0hg0s6pvr2sh0m',0,NULL);
INSERT INTO template_exercise VALUES('prpg0f71975beztk06i30xpj','dccpwum0gyrtyfykg4h1blqb','bvviauhoyyshk6rvn56qoj9a',1,NULL);
INSERT INTO template_exercise VALUES('vjmci1cr4ihchrlmi9hg4a91','fjkezhhvwdme7blzvun90vkr','ia978dj5361so8xhc2xgken6',0,NULL);
INSERT INTO template_exercise VALUES('h2dcmi7urnl8yglq0f83b5to','fjkezhhvwdme7blzvun90vkr','qqby4op48zaekyfedo1rci50',1,NULL);
CREATE TABLE template_set (
      id TEXT PRIMARY KEY NOT NULL,
      template_exercise_id TEXT NOT NULL REFERENCES template_exercise(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('normal', 'warm-up', 'drop')),
      weight REAL NOT NULL,
      reps INTEGER NOT NULL, duration INTEGER, distance REAL, rounds INTEGER, recovery INTEGER, rest INTEGER, target_rpe REAL, options INTEGER CHECK (options IN (0, 1)));
INSERT INTO template_set VALUES('oc4i2aas5oimqzc2b4ckn46n','wui0p8mdjs5289o08ecfc2ce',0,'warm-up',40.0,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('ncfmq0pe68qoob3xvrqexs6i','wui0p8mdjs5289o08ecfc2ce',1,'normal',82.5,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('ome5m58xtwh0wpssh12ppaur','wui0p8mdjs5289o08ecfc2ce',2,'normal',82.5,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('jmbi4sntvn72aaxjltdijk9z','wui0p8mdjs5289o08ecfc2ce',3,'normal',82.5,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('kvxe82aucnx8w8bdo35gy19u','mhw4byoj9n1nwzhq6r1d0y91',0,'normal',50.0,6,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('kpim6pbwu2hxi39n52y6ah5j','mhw4byoj9n1nwzhq6r1d0y91',1,'normal',50.0,6,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('tfc4hy9j4xnmyozk8rk89qtc','mhw4byoj9n1nwzhq6r1d0y91',2,'normal',50.0,6,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('mpe7eycg6vh1r42xddtux42d','fojmnkhxorxiuxiaprgdyiq2',0,'normal',15.0,12,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('pdinujh4h1hz0jpw4qmpp8kk','fojmnkhxorxiuxiaprgdyiq2',1,'drop',10.0,10,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('zbsn1btmj2aje2zj07ted4sm','ghcay4xzntuga0orckq9q888',0,'normal',72.5,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('g20ki6dcpa4aajxxd786ezc1','ghcay4xzntuga0orckq9q888',1,'normal',72.5,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('cp4ymb7buef5bq0xx1jt44dn','ghcay4xzntuga0orckq9q888',2,'normal',72.5,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('bmeicskgt85772cl3rdi8vdu','prpg0f71975beztk06i30xpj',0,'normal',0.0,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('xtur23e2odjjzalvdl9bmupf','prpg0f71975beztk06i30xpj',1,'normal',0.0,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('fwzbtb2p7150xtkdtlwsps9y','prpg0f71975beztk06i30xpj',2,'normal',0.0,7,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('tmfdazcm73htozdnubfamn9w','vjmci1cr4ihchrlmi9hg4a91',0,'warm-up',60.0,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('k5snle6bqdn2htqc5aw9dhoq','vjmci1cr4ihchrlmi9hg4a91',1,'normal',102.5,5,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('gc3kimcuzyzlfmsp0azfivew','vjmci1cr4ihchrlmi9hg4a91',2,'normal',102.5,5,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('z5ouzxsvj6zwi3qa2h3ctvfy','vjmci1cr4ihchrlmi9hg4a91',3,'normal',102.5,5,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('azizk1sovhr04mow0sq61jd8','h2dcmi7urnl8yglq0f83b5to',0,'normal',90.0,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('taivipxyl9mf4ymge8caovnp','h2dcmi7urnl8yglq0f83b5to',1,'normal',90.0,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO template_set VALUES('oltbpitrbxt6dm0iczzspol4','h2dcmi7urnl8yglq0f83b5to',2,'normal',90.0,8,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
CREATE TABLE workout (
      id TEXT PRIMARY KEY NOT NULL,
      template_id TEXT REFERENCES template(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      time_zone TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT, note TEXT);
INSERT INTO workout VALUES('aomro3ca58iv9zmyvzzrwa1x','d6loy6ghuzk5qtcwkmnf6na0','Push A','2026-09-29','Australia/Brisbane','2026-09-28T20:30:00.000Z','2026-09-28T21:30:00.000Z',NULL);
INSERT INTO workout VALUES('ii1f0sekdwjs61rlle8ldc4q','dccpwum0gyrtyfykg4h1blqb','Pull B','2026-10-01','Australia/Brisbane','2026-10-01T08:00:00.000Z','2026-10-01T09:00:00.000Z',NULL);
INSERT INTO workout VALUES('fpw7dgxg39f4ixmd7bfsijz0','fjkezhhvwdme7blzvun90vkr','Legs','2026-10-04','Australia/Brisbane','2026-10-03T23:00:00.000Z','2026-10-04T00:00:00.000Z',NULL);
INSERT INTO workout VALUES('ymwm5l8aw99oxtj6pwmqvh24','d6loy6ghuzk5qtcwkmnf6na0','Push A','2026-10-06','Australia/Brisbane','2026-10-05T20:30:00.000Z','2026-10-05T21:30:00.000Z',NULL);
INSERT INTO workout VALUES('nm8c0ed82zniwgw2xisacx51','fjkezhhvwdme7blzvun90vkr','Legs','2026-10-09','Australia/Brisbane','2026-10-08T21:00:00.000Z',NULL,'left knee sore');
CREATE TABLE workout_exercise (
      id TEXT PRIMARY KEY NOT NULL,
      workout_id TEXT NOT NULL REFERENCES workout(id) ON DELETE CASCADE,
      exercise_id TEXT NOT NULL REFERENCES exercise(id),
      position INTEGER NOT NULL, superset TEXT, note TEXT);
INSERT INTO workout_exercise VALUES('dr65k60wuyehxlsnsrzq0x6b','aomro3ca58iv9zmyvzzrwa1x','lshtvwyw2kca4ag2arrejp82',0,NULL,NULL);
INSERT INTO workout_exercise VALUES('vzjbmk73adzp4eawjdngoqie','aomro3ca58iv9zmyvzzrwa1x','e1t15cjw23pfser1gfo7bumq',1,NULL,NULL);
INSERT INTO workout_exercise VALUES('hwu2dogug8a6m5mwux99qki4','aomro3ca58iv9zmyvzzrwa1x','z9u6xleh70vwaos4681rib93',2,NULL,NULL);
INSERT INTO workout_exercise VALUES('gdn6novpw81fl46n1bwfqspz','ii1f0sekdwjs61rlle8ldc4q','lttalch1kn0hg0s6pvr2sh0m',0,NULL,NULL);
INSERT INTO workout_exercise VALUES('hqrz10mlpxya050wogql8okb','ii1f0sekdwjs61rlle8ldc4q','bvviauhoyyshk6rvn56qoj9a',1,NULL,NULL);
INSERT INTO workout_exercise VALUES('mopxtm99s0jvr4w6l08wv5mj','fpw7dgxg39f4ixmd7bfsijz0','ia978dj5361so8xhc2xgken6',0,NULL,NULL);
INSERT INTO workout_exercise VALUES('yamufyl8l6zjxv97bnw13mzw','fpw7dgxg39f4ixmd7bfsijz0','qqby4op48zaekyfedo1rci50',1,NULL,NULL);
INSERT INTO workout_exercise VALUES('nb43xj2rwhpt93pmg4fy2z6q','ymwm5l8aw99oxtj6pwmqvh24','lshtvwyw2kca4ag2arrejp82',0,NULL,NULL);
INSERT INTO workout_exercise VALUES('ti2pk5vdq9wh2ximzt8mbrji','ymwm5l8aw99oxtj6pwmqvh24','e1t15cjw23pfser1gfo7bumq',1,NULL,NULL);
INSERT INTO workout_exercise VALUES('h8swqxqihz1jqqc5v89ri94p','ymwm5l8aw99oxtj6pwmqvh24','z9u6xleh70vwaos4681rib93',2,NULL,NULL);
INSERT INTO workout_exercise VALUES('hnd3sqaou3u0fw1l6jh3urzx','nm8c0ed82zniwgw2xisacx51','ia978dj5361so8xhc2xgken6',0,NULL,NULL);
INSERT INTO workout_exercise VALUES('e47cgmwpvrw3c8yktphxymec','nm8c0ed82zniwgw2xisacx51','qqby4op48zaekyfedo1rci50',1,NULL,NULL);
CREATE TABLE workout_exercise_muscle (
      workout_exercise_id TEXT NOT NULL REFERENCES workout_exercise(id) ON DELETE CASCADE,
      muscle TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('primary', 'secondary')),
      PRIMARY KEY (workout_exercise_id, muscle));
INSERT INTO workout_exercise_muscle VALUES('dr65k60wuyehxlsnsrzq0x6b','chest','primary');
INSERT INTO workout_exercise_muscle VALUES('dr65k60wuyehxlsnsrzq0x6b','shoulders','secondary');
INSERT INTO workout_exercise_muscle VALUES('dr65k60wuyehxlsnsrzq0x6b','triceps','secondary');
INSERT INTO workout_exercise_muscle VALUES('vzjbmk73adzp4eawjdngoqie','shoulders','primary');
INSERT INTO workout_exercise_muscle VALUES('vzjbmk73adzp4eawjdngoqie','triceps','secondary');
INSERT INTO workout_exercise_muscle VALUES('hwu2dogug8a6m5mwux99qki4','chest','primary');
INSERT INTO workout_exercise_muscle VALUES('gdn6novpw81fl46n1bwfqspz','back','primary');
INSERT INTO workout_exercise_muscle VALUES('gdn6novpw81fl46n1bwfqspz','biceps','secondary');
INSERT INTO workout_exercise_muscle VALUES('hqrz10mlpxya050wogql8okb','back','primary');
INSERT INTO workout_exercise_muscle VALUES('hqrz10mlpxya050wogql8okb','biceps','secondary');
INSERT INTO workout_exercise_muscle VALUES('mopxtm99s0jvr4w6l08wv5mj','glutes','secondary');
INSERT INTO workout_exercise_muscle VALUES('mopxtm99s0jvr4w6l08wv5mj','quads','primary');
INSERT INTO workout_exercise_muscle VALUES('yamufyl8l6zjxv97bnw13mzw','back','secondary');
INSERT INTO workout_exercise_muscle VALUES('yamufyl8l6zjxv97bnw13mzw','glutes','secondary');
INSERT INTO workout_exercise_muscle VALUES('yamufyl8l6zjxv97bnw13mzw','hamstrings','primary');
INSERT INTO workout_exercise_muscle VALUES('nb43xj2rwhpt93pmg4fy2z6q','chest','primary');
INSERT INTO workout_exercise_muscle VALUES('nb43xj2rwhpt93pmg4fy2z6q','shoulders','secondary');
INSERT INTO workout_exercise_muscle VALUES('nb43xj2rwhpt93pmg4fy2z6q','triceps','secondary');
INSERT INTO workout_exercise_muscle VALUES('ti2pk5vdq9wh2ximzt8mbrji','shoulders','primary');
INSERT INTO workout_exercise_muscle VALUES('ti2pk5vdq9wh2ximzt8mbrji','triceps','secondary');
INSERT INTO workout_exercise_muscle VALUES('h8swqxqihz1jqqc5v89ri94p','chest','primary');
INSERT INTO workout_exercise_muscle VALUES('hnd3sqaou3u0fw1l6jh3urzx','glutes','secondary');
INSERT INTO workout_exercise_muscle VALUES('hnd3sqaou3u0fw1l6jh3urzx','quads','primary');
INSERT INTO workout_exercise_muscle VALUES('e47cgmwpvrw3c8yktphxymec','back','secondary');
INSERT INTO workout_exercise_muscle VALUES('e47cgmwpvrw3c8yktphxymec','glutes','secondary');
INSERT INTO workout_exercise_muscle VALUES('e47cgmwpvrw3c8yktphxymec','hamstrings','primary');
CREATE TABLE workout_set (
      id TEXT PRIMARY KEY NOT NULL,
      workout_exercise_id TEXT NOT NULL REFERENCES workout_exercise(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('normal', 'warm-up', 'drop')),
      weight REAL NOT NULL,
      reps INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)), duration INTEGER, distance REAL, rounds INTEGER, recovery INTEGER, rest INTEGER, target_rpe REAL, rpe REAL, comment TEXT, options INTEGER CHECK (options IN (0, 1)));
INSERT INTO workout_set VALUES('zx67apqz3yd0kjmzxfwckvl9','dr65k60wuyehxlsnsrzq0x6b',0,'warm-up',40.0,10,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('u7u4iyvu03xbosme01ff54fe','dr65k60wuyehxlsnsrzq0x6b',1,'normal',82.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('my6xkskladgyvbereh7qzil5','dr65k60wuyehxlsnsrzq0x6b',2,'normal',82.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('fypidd7ou2o98iewp7my8zyi','dr65k60wuyehxlsnsrzq0x6b',3,'normal',82.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('e1i9o0nckk31uczbet98uutt','vzjbmk73adzp4eawjdngoqie',0,'normal',50.0,6,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('s7uk1nk5s5xjjrbx8htr7z35','vzjbmk73adzp4eawjdngoqie',1,'normal',50.0,6,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('rqfmlw28pgbptewo1qf0hfd5','vzjbmk73adzp4eawjdngoqie',2,'normal',50.0,6,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('ffn3oksnac9sfui3i2mnkfmz','hwu2dogug8a6m5mwux99qki4',0,'normal',15.0,12,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('nqn842j9mbi04mojmn77q853','hwu2dogug8a6m5mwux99qki4',1,'drop',10.0,10,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('yfzp3tb39b87kb1p80nid3fk','gdn6novpw81fl46n1bwfqspz',0,'normal',72.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('eh3qbaiycclgpsni01sm3wzg','gdn6novpw81fl46n1bwfqspz',1,'normal',72.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('jvu6bs6t4xcv0m57xxljxuvw','gdn6novpw81fl46n1bwfqspz',2,'normal',72.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('g3ikq5svuu1lvyehdw3wivcy','hqrz10mlpxya050wogql8okb',0,'normal',0.0,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('hmaiqy4t8n0ziu6mxwr8hh25','hqrz10mlpxya050wogql8okb',1,'normal',0.0,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('vugnnw0mulovowqhkbz9yrlf','hqrz10mlpxya050wogql8okb',2,'normal',0.0,7,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('pudbhxwrmsyy19ecyzqxq5jz','mopxtm99s0jvr4w6l08wv5mj',0,'warm-up',60.0,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('eqp87fshqboubkpjhes1hx8z','mopxtm99s0jvr4w6l08wv5mj',1,'normal',102.5,5,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('kaozng48lt6aw4roc7hjsb0g','mopxtm99s0jvr4w6l08wv5mj',2,'normal',102.5,5,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('ayn1f598qq11p5qhpy9hhmh9','mopxtm99s0jvr4w6l08wv5mj',3,'normal',102.5,5,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('iu9ig716jw0elxhds3todjjq','yamufyl8l6zjxv97bnw13mzw',0,'normal',90.0,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('c510htq9peovkwgxosi2wzm6','yamufyl8l6zjxv97bnw13mzw',1,'normal',90.0,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('i6nxkcw5egu2jowcv5c9gsso','yamufyl8l6zjxv97bnw13mzw',2,'normal',90.0,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('m5kway2vp3k7e4u9j6w41v10','nb43xj2rwhpt93pmg4fy2z6q',0,'warm-up',40.0,10,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('z205gl5iyacc7pna7sckaqwk','nb43xj2rwhpt93pmg4fy2z6q',1,'normal',82.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('zis5zvn4bh4dgyvesvwrci96','nb43xj2rwhpt93pmg4fy2z6q',2,'normal',82.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('oppr2wkj6zqe902r0t53ac4r','nb43xj2rwhpt93pmg4fy2z6q',3,'normal',82.5,8,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('btkbjx8v3oxr0fh7534gqbl1','ti2pk5vdq9wh2ximzt8mbrji',0,'normal',50.0,6,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('jy2khdyz5b7byqrvrht4wx4a','ti2pk5vdq9wh2ximzt8mbrji',1,'normal',50.0,6,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('sz4tvtqt649f6kct2nnowznp','ti2pk5vdq9wh2ximzt8mbrji',2,'normal',50.0,6,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('u1tw7j45dk28pixlxupteo42','h8swqxqihz1jqqc5v89ri94p',0,'normal',15.0,12,1,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('tx30673s5i1ryusckt1cmjuv','h8swqxqihz1jqqc5v89ri94p',1,'drop',10.0,10,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('virfxiy0tc52mc96o8cu995x','hnd3sqaou3u0fw1l6jh3urzx',0,'warm-up',60.0,8,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('rmwfhb6th0gopg6oyqxjek2k','hnd3sqaou3u0fw1l6jh3urzx',1,'normal',102.5,5,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('wzii99al94tdebzq78i1menh','hnd3sqaou3u0fw1l6jh3urzx',2,'normal',102.5,5,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('a5e3fmo2kcz5e111lny08w7o','hnd3sqaou3u0fw1l6jh3urzx',3,'normal',102.5,5,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('ouqatyrzqb6x1hlghzzbanvl','e47cgmwpvrw3c8yktphxymec',0,'normal',90.0,8,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('iflb3llg8dinuz5xq1jsk4lx','e47cgmwpvrw3c8yktphxymec',1,'normal',90.0,8,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
INSERT INTO workout_set VALUES('pc6szcc6ngaff14k54ah07zy','e47cgmwpvrw3c8yktphxymec',2,'normal',90.0,8,0,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL);
CREATE TABLE schedule (
      id TEXT PRIMARY KEY NOT NULL,
      weekday TEXT NOT NULL UNIQUE CHECK (weekday IN ('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday')),
      template_id TEXT NOT NULL REFERENCES template(id) ON DELETE CASCADE);
INSERT INTO schedule VALUES('xbcrmsydzdtwzvg6si8d3n8r','monday','d6loy6ghuzk5qtcwkmnf6na0');
INSERT INTO schedule VALUES('i2thnhf0q3jfzhffsflxyrmn','thursday','dccpwum0gyrtyfykg4h1blqb');
CREATE TABLE schedule_change (
      id TEXT PRIMARY KEY NOT NULL,
      date TEXT NOT NULL UNIQUE,
      template_id TEXT REFERENCES template(id) ON DELETE SET NULL);
INSERT INTO schedule_change VALUES('tjkn6oi46oa6xexdjsy862kw','2026-10-08',NULL);
CREATE TABLE measurement_series (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      preset TEXT UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('weight', 'length')),
      method TEXT);
INSERT INTO measurement_series VALUES('dyhlr1kan7qtb2tp5abrlamk','Body weight','body-weight','weight',NULL);
INSERT INTO measurement_series VALUES('v7oq2n6vtmm9q2cme6e2s6pb','Left bicep','left-upper-arm','length',NULL);
INSERT INTO measurement_series VALUES('mvqvq13tl32otdtb2ubt61l5','Wrist',NULL,'length','Above the bone');
CREATE TABLE measurement (
      id TEXT PRIMARY KEY NOT NULL,
      series_id TEXT NOT NULL REFERENCES measurement_series(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      value REAL NOT NULL CHECK (value > 0),
      unit TEXT NOT NULL CHECK (unit IN ('kg', 'lb', 'cm', 'in')));
INSERT INTO measurement VALUES('tmrwb7ownq6j9e94nvkclk56','dyhlr1kan7qtb2tp5abrlamk','2026-10-01',82.4,'kg');
INSERT INTO measurement VALUES('fnktlf5sz9qsmjaz20k0dw80','v7oq2n6vtmm9q2cme6e2s6pb','2026-10-01',36.0,'cm');
CREATE INDEX workout_date ON workout(date);
CREATE UNIQUE INDEX exercise_source ON exercise(source);
CREATE INDEX measurement_series_date ON measurement(series_id, date);
COMMIT;
PRAGMA user_version=6;
