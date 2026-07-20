// ============================================================
// Миграция фото Google Drive → Supabase Storage
// Вставьте в script.google.com и нажмите Run → runMigration
// ============================================================

var SUPABASE_URL = 'https://dusmrxvybojyrqmmqxjx.supabase.co';
var SERVICE_KEY  = 'ВСТАВЬТЕ_SERVICE_ROLE_KEY';  // Settings → API → service_role

// Список: [pointId, driveFileId]
var POINTS = [
  ["1774526179251-mobaind-zl70","1uTdBg0h5pP6E2zyUlfIeWT9GIKR6vYHD"],
  ["1774526279482-mobaind-2wmq","1Ea-GnhGvXss1Ycfrz4xEEFg3FKwEWMEO"],
  ["1774526509981-mobaind-5dpz","1yX_Ls7NWQhcBXU2eCaxsLxN9krnUw3PF"],
  ["1774600534904-dskprsv-djpc","1EAxXD2pUjB7ZembamYaXNY4skVproe06"],
  ["1774756269277-dskprsv-x73h","11TlsUf2SUsncg9wBfreSUhDy1JgXdgzd"],
  ["1774756822949-dskprsv-nrri","1WHqQXL4w_kXEiHjWPRIWhxqrDp9CJvZ1"],
  ["1774757124086-dskprsv-12eg","1AKm2csptx_sSidg3kqDXrkz11kfBuNyq"],
  ["1774757398226-dskprsv-fey0","1IhciH6xVmLYYb_vb0CZWiMs3USV7sMFI"],
  ["1774758179912-dskprsv-94w5","1tbEywOdlx8Oe5yU3IEZQ9U-owOhN4ac9"],
  ["1774758510411-dskprsv-09qy","1fAIlpc5ls5NbVpFoqfoY71oZiA7lpTMH"],
  ["1774758810013-dskprsv-5cg1","1hxhQHH7GTKBOMTH68Aaer9e1cvJqW_u7"],
  ["1774759704686-dskprsv-ny1h","1vmTuF0u8vufLcWUNVIbd2l9-3uIvwCLM"],
  ["1774760697981-dskprsv-m5dd","1SmbubCMVN8Ml2qvI9Qs7eiDARqp6oMbu"],
  ["1774760780272-dskprsv-tu04","1S0Isoc1SE7gjgrtFk6LCyRilciiY_Z9l"],
  ["1776335576849-dskprsv-cy74","1DrfFAQEiHM-t1ZLpjDmPTefvGnsWKFHl"],
  ["1776336302961-dskprsv-md0i","1txKRbf20ksmx3ovRNAcf6Q2ScU09egqO"],
  ["1776336804496-dskprsv-uy76","1kP2fq4nUIQoeacPKkDaCoJ-EN0q_k-ir"],
  ["1776336938783-dskprsv-z7rl","1bfJXpi8l7K7hT9mxDtqaWjdbolxfOhJs"],
  ["1776337079987-dskprsv-n4cw","1rJBSj8GgilXF4AN7UjoGtjYj0W2VG6EJ"],
  ["1776339839233-dskprsv-4m53","1ufuO20UoPusyblaf3pYbToCQEUAAUZdU"],
  ["1776340477964-dskprsv-3t5e","1lwTzrBHzGL0y-HY4EtK0fTjraoKtr5da"],
  ["1776340659996-dskprsv-9qts","1o2FH6pPnR5f8w4iJ9V9DyQu5klkbcpoZ"],
  ["1776341095888-dskprsv-75lt","1iIx5-E7Pw9a_6YKXyO8sYJlB8rodGTSh"],
  ["1776341241902-dskprsv-8jew","11q4QPzqSVFzC3a7PvVnZ6nOE-T_qAOBf"],
  ["1776511272639-dskprsv-rak2","13UMi3pDuX4f7luU9fvCfersWJMCJEWTS"],
  ["1776514741503-dskprsv-3vb0","1-8qh1wZc_Dv-bxzNMoCcRjNBtG_uh3RZ"],
  ["1776515056228-dskprsv-buzo","1weMilJLH0-ECm62DG2wUo9BI9p_CD-CT"],
  ["1776515167638-dskprsv-jn82","1Fo8PHUN5WkV9jLlaMRmUiOJjksJtoPs1"],
  ["1776515264699-dskprsv-l2wp","19lEZzH40Q9xTKUC0Gn7kOToat-Uwuzh0"],
  ["1776515535761-dskprsv-nv6n","1Q6cEyjSz4NOKdTegkue7LXyI7zj2NyKP"],
  ["1776515850610-dskprsv-qron","1bobi9stGvEDq7dQRGYW9ibHyNYWOoAo2"],
  ["1776516070882-dskprsv-vndy","1gA9plEl072c7Wrw8BKAy6TRhruaLYt-C"],
  ["1776516361312-dskprsv-s7s7","13qqTcmzD3tRnebcj2TH6gCr9hjmSi3Ey"],
  ["1776516637211-dskprsv-2nzb","1ovSZQrmjzMzqKmqYh9G57yGC6VmC_ifR"],
  ["1776516816622-dskprsv-3ky3","1T8T3o1VbFWAfNMJJaA5ZYLV-ewWbzp2o"],
  ["1776517075777-dskprsv-d2lp","1QKYYaQFsqAgW0SSZICUSJkx7LW5j7jKq"],
  ["1776517319596-dskprsv-u4cb","1y8YsLHsi3PzMqVtnoJJKkOP9AdD2AFbZ"],
  ["1776517508077-dskprsv-9qvt","179ulW3aKd05dIiubxLBo3-7acWwoNsbC"],
  ["1776517841299-dskprsv-cziu","1XAqa6KZqWfgqoRBV_72zwNQqlJ2Gk9ze"],
  ["1776518294839-dskprsv-zoao","1jJkcOznMHw62o_WvXSZsq1bgMOuL_cdN"],
  ["1776518605302-dskprsv-3a08","1qnu2ShJWNEVn8xt-o2lpFRJGM8Es67MJ"],
  ["1776519256584-dskprsv-9rnz","1pRhYhQo8Ny45w1HKGr8r2X3p9zbkpoGa"],
  ["1776525583152-dskprsv-wknk","1Q0FYr8c3O8tWLKh9JVC-L6Rs1H7FXOMP"],
  ["1776525835496-dskprsv-zfx5","1Cv9mC8uPmmmjAVlDP-bcPrVxyJDSa0he"],
  ["1776526072856-dskprsv-5vz7","1oK55P3Z4VPAt0D8hv-HHgX1MZ1SJwEU-"],
  ["1776591913390-mobaind-1b09","1CAwbP1OCHKPij4w2SODVRrPJAnDp9dME"],
  ["1776592700315-mobaind-stz1","1XZ5r1cmf0_rubkACAmL_kILCC_LfTbVp"],
  ["1776593096521-mobaind-yxjk","1_1lEuF9NNTkZO1F6OseNSZcN_k8ws5_v"],
  ["1776593243396-mobaind-3j3d","12A2m2U3_Z7TjM1IGACmc9avUVZLklAkW"],
  ["1776593416346-mobaind-4f04","1S51sFs6QDSkS4R_6TK0SDCBJbJ9UwshV"],
  ["1776594028672-mobaind-fze3","1ytt99eT9rCpP9pv8I3s1ldS9tgLhqBKT"],
  ["1776594277842-mobaind-90zo","1qZ9HuaruUHF_STjbTlEnmWncD-b91URA"],
  ["1776594546660-mobaind-13zo","1RuEmrIbwZHE4OSPCg6DmEraKbmF3J6Ig"],
  ["1777088999081-dskprsv-r6so","1oRiAgqm7kx3gFZdt22cz7QVhdSptm1EN"],
  ["1777089361471-dskprsv-rcm1","1RQlc1WKoZ2ZYLnOtRCl0nEGRVWmAiz_g"],
  ["1777089573799-dskprsv-jy0u","1cN-GpLCLmRbOCARVcCu-hLo1_0mTpB-h"],
  ["1777089864782-dskprsv-vmij","1ji1M_MTJ_ZIyMP73lB5x9UAiGvypw8tl"],
  ["1777090043166-dskprsv-oxoe","1xxIfEBEO5h0UQ0b5xLqTaE7Cr38fE0sx"],
  ["1777090454455-dskprsv-stsg","1am8jirGplsCnOjNw_rnA2wsA6JbknuzI"],
  ["1777090948695-dskprsv-nybu","1FQU_nQoA3XWxSXTrwSlWNd8VxTL03C6p"],
  ["1777109622297-mobaind-hys6","1jJBl02TKlIjFjdje92_qjm4DslDaRdYz"],
  ["1777111304071-mobaind-10w9","1bZ7vNSwR7ApZt2QwBUjatANWW1cbj0_2"],
  ["1777111574238-mobaind-jp29","1CSJaA8UfIu24-94Uv0FyzAexam-NjKvZ"],
  ["1777111824695-mobaind-26zu","1drVt8yiuORhhjIyKkzttYKvwBktm1-oD"],
  ["1777170969356-dskprsv-3v2s","1OxR11Agk1shyhpps6ayexWA28QHlBMXr"],
  ["1777171082246-dskprsv-h1jy","1vS9qFBoWo5hAJoXNWbAKTH4jOQz4hQ5m"],
  ["1777171312538-dskprsv-utq3","15rlVIhLMUD_9uVzIWG_hcK52oPCbao2_"],
  ["1777171398749-dskprsv-qgc6","1IRkLFfdnm6U4RYV5ewGfi2MiPGMjWxN3"],
  ["1777171730516-dskprsv-am3m","1pRIHOJ01GB1g9_nv8qXLX-Tl0xlOTLdT"],
  ["1777171894093-dskprsv-9asq","1JgTXauEq6LpecD2glTQ17EZOACrHUPjj"],
  ["1777176423178-dskprsv-4qyj","1wXg2B878KMZmJgHcIFb_eWdAzosNBX7S"],
  ["1777177347821-dskprsv-w1h1","1QJN4eTO_KqliiPZjZvq3wO8aOFgBalzq"],
  ["1777177802700-dskprsv-p98c","1AsLO7Yc0AjTA5AnTFAd9-VTF-JgTNn2v"],
  ["1777177999529-dskprsv-p36k","1KW8urpZTfoqBVZZ7cFSmqFHISsJCtxJJ"],
  ["1777178355188-dskprsv-a6i9","15LwbZSz7En3_C3bvPQnLiM_BGxfeTYb1"],
  ["1777179617872-dskprsv-5hj0","1FaxPgaFanEkUc6EdbWDzKO6Q4s0gYe9A"],
  ["1777179907183-dskprsv-5b7t","1WcHwy1TdK8-LJtHAqHnspcZLEC1KdWKY"],
  ["1777180091215-dskprsv-pwmp","17Kvg8RtPue8p4YEKwtzmlaZx2rR0yyqf"],
  ["1777180186632-dskprsv-6sca","1fvqzbTMNLS8KJv-Mqboau4r6nkh_M4IH"],
  ["1777180294506-dskprsv-aie8","1aPrFIlSD__ltz6_HSdTtn3yFqy87ay72"],
  ["1777180861614-dskprsv-y3an","1w4cwsQiwxsDg7ktKhl9fMp9SQYfEm549"],
  ["1777181011364-dskprsv-oy69","1dpZmBEk7Mcb7DsHXXorAH5ATwEKHYO-R"],
];

function runMigration() {
  Logger.log('=== Миграция фото Drive → Supabase ===');
  Logger.log('Всего точек: ' + POINTS.length);

  var ok = 0, failed = 0;
  var errors = [];

  for (var i = 0; i < POINTS.length; i++) {
    var pointId = POINTS[i][0];
    var fileId  = POINTS[i][1];
    var label   = '[' + (i+1) + '/' + POINTS.length + '] ' + pointId.slice(-8);

    try {
      // 1. Читаем файл из Google Drive
      var file = DriveApp.getFileById(fileId);
      var blob = file.getBlob();
      var mime = blob.getContentType() || 'image/jpeg';
      var bytes = blob.getBytes();

      // 2. Загружаем в Supabase Storage
      var ext = mime.split('/')[1] || 'jpg';
      var storagePath = pointId + '/' + new Date().getTime() + '_' + i + '.' + ext;

      var uploadUrl = SUPABASE_URL + '/storage/v1/object/photos/' + storagePath;
      var uploadResp = UrlFetchApp.fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'Content-Type': mime,
          'x-upsert': 'false',
        },
        payload: bytes,
        muteHttpExceptions: true,
      });

      var uploadStatus = uploadResp.getResponseCode();
      if (uploadStatus !== 200) {
        throw new Error('Storage ' + uploadStatus + ': ' + uploadResp.getContentText().slice(0, 100));
      }

      // 3. Получаем публичный URL
      var publicUrl = SUPABASE_URL + '/storage/v1/object/public/photos/' + storagePath;

      // 4. Читаем текущие фото точки
      var getUrl = SUPABASE_URL + '/rest/v1/points?id=eq.' + encodeURIComponent(pointId) + '&select=photos';
      var getResp = UrlFetchApp.fetch(getUrl, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'apikey': SERVICE_KEY,
        },
        muteHttpExceptions: true,
      });
      var rows = JSON.parse(getResp.getContentText());
      var existing = (rows && rows[0] && rows[0].photos) ? rows[0].photos : [];

      // 5. Обновляем запись
      var updated = [publicUrl].concat(existing);
      var patchUrl = SUPABASE_URL + '/rest/v1/points?id=eq.' + encodeURIComponent(pointId);
      var patchResp = UrlFetchApp.fetch(patchUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': 'Bearer ' + SERVICE_KEY,
          'apikey': SERVICE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        payload: JSON.stringify({ photos: updated }),
        muteHttpExceptions: true,
      });

      var patchStatus = patchResp.getResponseCode();
      if (patchStatus !== 200 && patchStatus !== 204) {
        throw new Error('DB PATCH ' + patchStatus + ': ' + patchResp.getContentText().slice(0, 100));
      }

      Logger.log(label + ': ✅ OK');
      ok++;

    } catch(e) {
      Logger.log(label + ': ❌ ' + e.message);
      errors.push({ point: pointId, fileId: fileId, error: e.message });
      failed++;
    }

    Utilities.sleep(200);
  }

  Logger.log('');
  Logger.log('=== ИТОГ ===');
  Logger.log('✅ Успешно: ' + ok);
  Logger.log('❌ Ошибок:  ' + failed);
  if (errors.length > 0) {
    Logger.log('Ошибки: ' + JSON.stringify(errors, null, 2));
  }
}
