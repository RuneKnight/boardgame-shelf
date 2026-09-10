/**
 * Google Apps Script for Board Game Management Web App
 * 
 * [설정 방법]
 * 1. 관리하려는 구글 스프레드시트를 웹 브라우저로 엽니다.
 * 2. 상단 메뉴의 [확장 프로그램] -> [Apps Script]를 클릭합니다.
 * 3. 기존 코드를 모두 지우고 이 파일의 내용을 복사하여 붙여넣습니다.
 * 4. 우측 상단 [배포] -> [새 배포] 버튼을 클릭합니다.
 * 5. 유형 선택(톱니바퀴)에서 [웹 앱]을 선택합니다.
 *    - 설명: 보드게임 관리 웹앱
 *    - 다음 사용자 권한으로 실행: '나(내 계정)'
 *    - 액세스 권한이 있는 사용자: '모든 사용자(Anyone)'  <-- 중요!
 * 6. [배포]를 클릭하고 Google 계정 권한 승인을 완료합니다.
 * 7. 발급된 '웹 앱 URL'(https://script.google.com/macros/s/.../exec)을 복사하여
 *    보드게임 웹페이지의 [⚙️ 설정] -> [Google Apps Script 웹 앱 URL]에 입력합니다.
 * 
 * ★ 효과: 브라우저의 CORS 제한 없이 실시간 시트 읽기(GET) 및 실시간 쓰기/수정(POST)이 100% 완벽 동작합니다.
 */

// 1. 시트 데이터 실시간 조회 (GET)
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || 'get';

  if (action === 'ping') {
    return createJsonResponse({ status: 'success', message: 'Apps Script 정상 작동 중' });
  }

  // 기본 액션: 시트의 모든 데이터를 JSON으로 반환
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var values = sheet.getDataRange().getValues();
    if (!values || values.length === 0) {
      return createJsonResponse({ status: 'success', data: [] });
    }

    // 헤더 행 찾기
    var headerRowIndex = 0;
    for (var i = 0; i < Math.min(5, values.length); i++) {
      for (var j = 0; j < values[i].length; j++) {
        if (String(values[i][j]).indexOf('게임명') !== -1) {
          headerRowIndex = i;
          break;
        }
      }
    }

    var games = [];
    for (var r = headerRowIndex + 1; r < values.length; r++) {
      var row = values[r];
      var name = row[0] ? String(row[0]).trim() : '';
      if (!name) continue;

      var minP = parseInt(row[1], 10);
      var maxP = parseInt(row[2], 10);

      games.push({
        id: 'row_' + (r + 1),
        rowIndex: r + 1,
        name: name,
        minPlayers: isNaN(minP) ? null : minP,
        maxPlayers: isNaN(maxP) ? null : maxP,
        system: row[3] ? String(row[3]).trim() : '',
        notes: row[4] ? String(row[4]).trim() : '',
        bestPlayers: row[5] ? String(row[5]).trim() : '',
        difficulty: row[6] ? String(row[6]).trim() : '',
        owner: row[7] ? String(row[7]).trim() : '',
        isLocal: false
      });
    }

    return createJsonResponse({ status: 'success', data: games, total: games.length });
  } catch (err) {
    return createJsonResponse({ status: 'error', message: err.toString() });
  }
}

// 2. 시트 데이터 실시간 쓰기 / 수정 / 삭제 (POST)
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 동시성 락
  } catch (err) {
    return createJsonResponse({ status: 'error', message: '서버가 바쁩니다. 잠시 후 다시 시도해주세요.' });
  }

  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var payload = JSON.parse(e.postData.contents);
    var action = payload.action || 'add';

    if (action === 'add') {
      var newRow = [
        payload.name || '',
        payload.minPlayers !== undefined ? payload.minPlayers : '',
        payload.maxPlayers !== undefined ? payload.maxPlayers : '',
        payload.system || '',
        payload.notes || '',
        payload.bestPlayers || '',
        payload.difficulty || '',
        payload.owner || ''
      ];
      sheet.appendRow(newRow);
      return createJsonResponse({ status: 'success', message: '새 게임이 스프레드시트에 등록되었습니다.' });
    } 
    
    else if (action === 'update') {
      var rowIndex = payload.rowIndex;
      if (!rowIndex || rowIndex < 2) {
        var data = sheet.getDataRange().getValues();
        for (var i = 1; i < data.length; i++) {
          if (data[i][0] === payload.originalName || data[i][0] === payload.name) {
            rowIndex = i + 1;
            break;
          }
        }
      }

      if (rowIndex && rowIndex >= 2) {
        var updateRow = [
          payload.name || '',
          payload.minPlayers !== undefined ? payload.minPlayers : '',
          payload.maxPlayers !== undefined ? payload.maxPlayers : '',
          payload.system || '',
          payload.notes || '',
          payload.bestPlayers || '',
          payload.difficulty || '',
          payload.owner || ''
        ];
        sheet.getRange(rowIndex, 1, 1, 8).setValues([updateRow]);
        return createJsonResponse({ status: 'success', message: '게임 정보가 수정되었습니다.' });
      } else {
        return createJsonResponse({ status: 'error', message: '수정할 대상 행을 찾을 수 없습니다.' });
      }
    } 
    
    else if (action === 'delete') {
      var targetRow = payload.rowIndex;
      if (!targetRow || targetRow < 2) {
        var data = sheet.getDataRange().getValues();
        for (var j = 1; j < data.length; j++) {
          if (data[j][0] === payload.name) {
            targetRow = j + 1;
            break;
          }
        }
      }

      if (targetRow && targetRow >= 2) {
        sheet.deleteRow(targetRow);
        return createJsonResponse({ status: 'success', message: '게임이 삭제되었습니다.' });
      } else {
        return createJsonResponse({ status: 'error', message: '삭제할 대상 행을 찾을 수 없습니다.' });
      }
    }

    return createJsonResponse({ status: 'error', message: '지원하지 않는 액션입니다: ' + action });
  } catch (error) {
    return createJsonResponse({ status: 'error', message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
