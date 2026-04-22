document.addEventListener('DOMContentLoaded', function() {
    
    // =========================================================
    // 💡 [필수 설정] 파이어베이스(Firebase) 실시간 데이터베이스 연동
    // 구글 Firebase (https://firebase.google.com/) 에서 새 프로젝트를 
    // 생성한 후, 아래 설정값을 본인의 것으로 교체하세요!
    // =========================================================
    const firebaseConfig = {
        apiKey: "AIzaSyDWxaW9mHHgmDuqit1dEXoXN_O8TX48uKs",
        authDomain: "project-calender-infac.firebaseapp.com",
        projectId: "project-calender-infac",
        storageBucket: "project-calender-infac.firebasestorage.app",
        messagingSenderId: "485522493873",
        appId: "1:485522493873:web:da50ac413ec955d5396d90"
    };

    // Firebase 연동 상태 체크 기능
    let db = null;
    let isFirebaseActive = false;
    
    // 만약 설정값이 기본값이 아니라면 Firebase 초기화
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "여기에_API_KEY_입력") {
        firebase.initializeApp(firebaseConfig);
        db = firebase.firestore();
        isFirebaseActive = true;
        console.log("Firebase 연동이 완료되었습니다!");
    } else {
        alert("⚠️ 현재 실시간 공유 기능이 꺼져있습니다.\n(개인 보관용 모드로 실행 중입니다.)\n\n이 앱을 팀원과 실시간으로 공유하시려면, app.js의 firebaseConfig 값을 구글 Firebase 설정값으로 채워주세요.");
    }

    // [헬퍼] 로컬 타임존을 고려하여 YYYY-MM-DD 형식으로 날짜 포맷팅
    function formatDate(date) {
        if (!date) return '';
        const d = (typeof date === 'string') ? new Date(date) : date;
        if (isNaN(d.getTime())) return '';
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    // [헬퍼] 이벤트 정렬용 24시간 단위 시간(분) 계산 (시간 없으면 9999 반환하여 맨 아래로 배치)
    function getSortTimeVal(timeStr) {
        if (!timeStr) return 9999;
        let parts = timeStr.trim().split(' ');
        if (parts.length < 2) return 9999;
        let ampm = parts[0];
        let timeParts = parts[1].split(':');
        let h = parseInt(timeParts[0], 10) || 0;
        let m = parseInt(timeParts[1], 10) || 0;
        if (ampm === '오후' && h !== 12) h += 12;
        if (ampm === '오전' && h === 12) h = 0;
        return h * 60 + m;
    }

    // --- 1. 전역 시스템 데이터 로드 및 초기화 --- //
    const defaultProjects = [
        { id: 'proj_dev', name: '개발 진행', color: 'var(--color-dev)' },
        { id: 'proj_design', name: '디자인 시안', color: 'var(--color-design)' },
        { id: 'proj_market', name: '마케팅/기획', color: 'var(--color-marketing)' },
        { id: 'proj_issue', name: '이슈/버그', color: 'var(--color-issue)' }
    ];
    let customProjects = defaultProjects;

    // 카테고리 로드
    if (!isFirebaseActive) {
        customProjects = JSON.parse(localStorage.getItem('customProjects')) || defaultProjects;
        renderProjectsUI();
    } else {
        // Firebase 실시간 동기화 (카테고리 정보)
        db.collection("config").doc("projects").onSnapshot((doc) => {
            if (doc.exists) {
                customProjects = doc.data().list;
            } else {
                // 파이어베이스에 데이터가 없으면 기본값 업로드
                db.collection("config").doc("projects").set({ list: defaultProjects });
                customProjects = defaultProjects;
            }
            renderProjectsUI();
            if(calendar) applyFilters();
            if(subCalendar) {
                subCalendar.getResources().forEach(r => r.remove());
                customProjects.forEach(p => subCalendar.addResource({ id: p.id, title: p.name, eventColor: p.color }));
            }
        });
    }

    // [핵심 로직] "현재 진행 중(Ongoing)"인 일정은 로드할 때마다 '오늘 시점 기준의 내일'로 종료일을 자동 리셋하여 끝없이 이어지게 만듦
    function applyOngoingDate(eventData) {
        if (eventData.extendedProps && eventData.extendedProps.isOngoing) {
            const tmrw = new Date();
            tmrw.setDate(tmrw.getDate() + 1);
            eventData.end = formatDate(tmrw);
        }
        return eventData;
    }

    function renderProjectsUI() {
        const container = document.getElementById('projectListContainer');
        container.innerHTML = '';
        customProjects.forEach(proj => {
            container.innerHTML += `
                <li>
                    <label class="custom-checkbox">
                        <input type="checkbox" value="${proj.id}" class="filter-chk" checked>
                        <span class="checkmark" style="--checked-bg: ${proj.color}; border-color: ${proj.color};"></span>
                        ${proj.name}
                    </label>
                </li>
            `;
        });

        const select = document.getElementById('eventProject');
        select.innerHTML = '';
        customProjects.forEach(proj => {
            select.innerHTML += `<option value="${proj.id}">${proj.name}</option>`;
        });

        bindFilterCheckboxes();
    }
    
    function getProjectColor(projId) {
        const p = customProjects.find(p => p.id === projId);
        return p ? p.color : 'var(--color-dev)';
    }

    // --- 2. 캘린더 세팅 --- //
    const calendarEl = document.getElementById('calendar');
    let savedEvents = [];
    let subCalendar = null;
    let savedSubEvents = [];
    
    // 매트릭스 전역 데이터 로드 및 초기화
    let matrixTasks = JSON.parse(localStorage.getItem('matrixTasks')) || [];
    
    const calendar = new FullCalendar.Calendar(calendarEl, {
        height: 'auto', // 사용자가 무한 자동 확장에 따른 웹사이트 자체 휠 스크롤을 선호하므로 다시 auto로 롤백
        initialView: 'dayGridMonth',
        locale: 'ko',
        headerToolbar: {
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek,listMonth'
        },
        buttonText: { today: '오늘', month: '월간', week: '주간', list: '목록' },
        eventOrder: function(a, b) {
            let startA = a.start ? a.start.valueOf() : 0;
            let startB = b.start ? b.start.valueOf() : 0;
            if (startA !== startB) return startA - startB;

            let endA = a.end ? a.end.valueOf() : startA;
            let endB = b.end ? b.end.valueOf() : startB;
            let durA = endA - startA;
            let durB = endB - startB;
            if (durA !== durB) return durB - durA;

            let tA = (a.extendedProps && a.extendedProps.sortTime !== undefined) ? a.extendedProps.sortTime : 9999;
            let tB = (b.extendedProps && b.extendedProps.sortTime !== undefined) ? b.extendedProps.sortTime : 9999;
            if (tA !== tB) return tA - tB;

            let titleA = a.title || '';
            let titleB = b.title || '';
            return titleA.localeCompare(titleB);
        },
        events: [],
        editable: true,
        nowIndicator: true, // [추가] 오늘 날짜/시간 현재선 가이드 표시
        dayMaxEvents: false, // 일정이 수십개여도 숨기지 않음
        selectable: true,
        droppable: true, // 외부 드래그 요소 활성화
        eventReceive: function(info) {
            const ev = info.event;
            const matrixId = ev.id; 
            const title = ev.title;
            const startStr = ev.startStr;
            const defaultProj = customProjects.length > 0 ? customProjects[0].id : 'proj_default';
            
            ev.remove(); // 즉각 생성하지 않고 폼 입력을 받도록 렌더 스텁 바로 삭제
            
            openEventModal(false, 'main', true); // 저장위치 고정
            document.getElementById('eventTitle').value = title;
            document.getElementById('eventStart').value = startStr;
            const projectSelect = document.getElementById('eventProject');
            if(projectSelect) projectSelect.value = defaultProj;
            
            // 모달 제출 전까지 임시 매트릭스 ID 보관
            document.getElementById('pendingMatrixId').value = matrixId;
        },
        eventDisplay: 'block',

        eventContent: function(arg) {
            let title = arg.event.title || '';
            let type = arg.event.extendedProps.eventType;
            let projectCode = arg.event.extendedProps.project;
            let desc = arg.event.extendedProps.description || '';
            let timeStr = arg.event.extendedProps.eventTime || '';
            let isImportant = arg.event.extendedProps.isImportant || false;
            
            let projColor = getProjectColor(projectCode);
            let projAbbrev = '';
            const foundProj = customProjects.find(p => p.id === projectCode);
            if(foundProj && foundProj.abbrev) projAbbrev = foundProj.abbrev;
            else if(foundProj) projAbbrev = foundProj.name.substring(0, 2);
            
            let projBadgeHtml = projAbbrev ? `<span class="event-badge" style="background-color:${projColor} !important; color:var(--bg-darker) !important; font-weight:700; margin-right:4px;">${projAbbrev}</span>` : '';
            let timeBadgeHtml = timeStr ? `<span style="background-color:rgba(255,255,255,0.25) !important; padding:1px 5px; border-radius:4px; font-size:13px; margin-right:4px;"><i class="far fa-clock"></i> ${timeStr}</span>` : '';
            
            let titleHtml = `<span style="font-weight:bold;">${title}</span>`;
            let descHtml = desc ? `<span class="event-desc-text"> - ${desc}</span>` : '';
            let importantHtml = isImportant ? `<span style="color:#facc15; margin-right:4px; font-weight:bold;">⭐</span>` : '';
            
            // 호버 상세 정보 그룹
            let detailGroupHtml = `<span class="event-detail-group">${timeBadgeHtml}${descHtml}</span>`;
            
            let badgeHtml = type ? `<span class="event-badge" style="background-color:rgba(255,255,255,0.2) !important; color:white !important; margin-right:4px; font-weight:600;">${type}</span>` : '';
            
            // 중요 일정 강조 스타일
            const borderStyle = isImportant ? `border-left:5px solid #facc15 !important; box-shadow: 0 0 10px rgba(250, 204, 21, 0.4);` : `border-left:3px solid ${projColor} !important;`;
            const bgColor = isImportant ? `background:rgba(250, 204, 21, 0.15) !important;` : `background:rgba(51, 65, 85, 0.8) !important;`;
            
            return { html: `<div class="custom-event" style="display:flex; flex-direction:row; align-items:center; flex-wrap:wrap; padding:2px 4px; overflow:hidden; ${borderStyle} ${bgColor}">${importantHtml}${projBadgeHtml}${badgeHtml}<span class="event-title" style="margin-left:4px;">${titleHtml}${detailGroupHtml}</span></div>` };
        },
        
        select: function(info) {
            openEventModal(false, 'main', true); // 저장위치 고정
            document.getElementById('eventStart').value = info.startStr.split('T')[0];
            if (info.endStr) {
                const end = new Date(info.endStr);
                end.setDate(end.getDate() - 1);
                document.getElementById('eventEnd').value = formatDate(end);
            }
        },

        eventClick: function(info) {
            openEventModal(true, 'main');
            const event = info.event;
            document.getElementById('eventId').value = event.id; // 파이어베이스 도큐먼트 ID
            document.getElementById('eventTitle').value = event.title;
            document.getElementById('eventType').value = event.extendedProps.eventType || '일반';
            document.getElementById('eventProject').value = event.extendedProps.project;
            document.getElementById('eventDescription').value = event.extendedProps.description || '';
            
            const isOngoing = event.extendedProps.isOngoing || false;
            document.getElementById('eventOngoing').checked = isOngoing;
            document.getElementById('eventEnd').disabled = isOngoing;
            document.getElementById('eventTime').value = event.extendedProps.eventTime || '';
            
            const isImportant = event.extendedProps.isImportant || false;
            const importantCb = document.getElementById('eventImportant');
            if(importantCb) importantCb.checked = isImportant;
            
            document.getElementById('eventStart').value = event.startStr.split('T')[0];
            if (event.end && !isOngoing) {
                const end = new Date(event.end);
                end.setDate(end.getDate() - 1);
                document.getElementById('eventEnd').value = formatDate(end);
            } else {
                document.getElementById('eventEnd').value = '';
            }
        },
        eventDrop: function(info) { 
            // 메인 캘린더는 다시 원래대로 중립 배경색 사용 (뱃지형)
            info.event.setProp('backgroundColor', 'rgba(51, 65, 85, 0.8)');
            updateSingleEventStore(info.event, 'main'); 
        },
        eventResize: function(info) { 
            info.event.setProp('backgroundColor', 'rgba(51, 65, 85, 0.8)');
            updateSingleEventStore(info.event, 'main'); 
        }
    });

    calendar.render();

    // Firebase 실시간 동기화 (일정 목록)
    if (isFirebaseActive) {
        db.collection("events").onSnapshot((querySnapshot) => {
            savedEvents = [];
            querySnapshot.forEach((doc) => {
                let eventData = doc.data();
                eventData.id = doc.id; // Firebase Primary Key 매핑
                
                // 메인 캘린더는 고정된 중립색 막대기(Slate-700) 기반 뱃지형 디자인 사용
                eventData.backgroundColor = 'rgba(51, 65, 85, 0.8)';
                eventData.borderColor = 'rgba(51, 65, 85, 0.8)';
                if (eventData.extendedProps) eventData.extendedProps.sortTime = getSortTimeVal(eventData.extendedProps.eventTime);
                eventData = applyOngoingDate(eventData);
                savedEvents.push(eventData);
            });
            calendar.removeAllEventSources();
            calendar.addEventSource(savedEvents);
        });
    } else {
        // 로컬 스토리지 모드 : 메인 캘린더 중립 배경색 원복
        let localEvents = JSON.parse(localStorage.getItem('calendarEvents')) || [];
        localEvents = localEvents.map(e => {
            e.backgroundColor = 'rgba(51, 65, 85, 0.8)';
            e.borderColor = 'rgba(51, 65, 85, 0.8)';
            if (e.extendedProps) e.extendedProps.sortTime = getSortTimeVal(e.extendedProps.eventTime);
            return applyOngoingDate(e);
        });
        calendar.addEventSource(localEvents);
    }

    // --- 2-2. 서브 캘린더 (월간 요약) 세팅 --- //
    // 프로젝트명 최대 문자열 길이를 Canvas API로 동적 계산하여 완벽히 맞는 고정 여백(Pix) 자동 생성
    function getDynamicResourceWidth() {
        if (!customProjects || customProjects.length === 0) return '150px';
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        context.font = "bold 14px Pretendard, sans-serif"; // 캘린더 사이드바 기본 폰트 근사치
        let maxWidth = 100;
        customProjects.forEach(p => {
            const w = context.measureText(p.name).width;
            if (w > maxWidth) maxWidth = w;
        });
        return Math.floor(maxWidth + 40) + 'px'; // 좌우 패딩 여백(40px) 추가 확보
    }

    const subCalendarEl = document.getElementById('subCalendar');
    subCalendar = new FullCalendar.Calendar(subCalendarEl, {
        schedulerLicenseKey: 'CC-Yield',
        views: {
            customTimeline: {
                type: 'resourceTimeline',
                duration: { months: 24 }, // 24개월 고정
                slotMinWidth: 2,                   
                slotDuration: { days: 1 }, // 2번 요청 복귀: 다시 일(Day)별로 구간이 분할되도록 롤백하여 막대기 길이가 일자별로 직관적으로 보이게 복구
                slotLabelFormat: [
                    { year: 'numeric' }, 
                    { month: 'short' },
                    { day: 'numeric' }   // CSS로 숨길 하위 티어 부활 (세로줄 정렬 맞춤용)
                ]
            }
        },
        initialView: 'customTimeline',
        initialDate: new Date(new Date().getFullYear() - 1, 0, 1).toISOString().split('T')[0], 
        dateIncrement: { months: 3 }, // < > 누르면 분기(3칸) 단위로 이동
        height: 450, 
        expandRows: true, // 모든 행(프로젝트)이 남는 가용 높이를 1/N로 동일한 비율로 꽉 채워 균등 팽창하도록 록업
        slotLaneDidMount: function(arg) {
            // 1월 배경색 오버레이 시도 원복 및 세로선 타겟으로 확실한 구분
            if (arg.date.getDate() !== 1) {
                arg.el.style.borderLeft = 'none';
                arg.el.style.borderRight = 'none';
            } else {
                if (arg.date.getMonth() === 0) {
                    arg.el.style.borderLeft = '2px solid rgba(59, 130, 246, 0.4)'; // 파란색 약간 두꺼운 세로선 적용
                } else {
                    arg.el.style.borderLeft = '1px solid rgba(255,255,255,0.15)'; 
                }
            }
            
            // 더 이상背景색 오버레이 꼼수를 쓰지 않고 투명으로 둠
            arg.el.style.background = 'transparent';
        },
        slotLabelContent: function(arg) {
            // Preact 충돌로 인한 텍스트 중복 에러를 막기 위해 내부 DOM 조작이 아닌 정식 Content 후크 사용
            if (arg.level === 1) { 
                let pureMonth = (arg.date.getMonth() + 1) + '월';
                if (arg.date.getMonth() === 0) {
                    return { html: `<span style="color:#fef08a !important; font-weight:800; font-size:0.85rem;">${pureMonth}</span>` };
                }
                return { html: pureMonth };
            } else if (arg.level === 2) { 
                // 하위 티어의 날짜를 깔끔하게 숨기되, 1일에 한해서만 '1일'로 표기
                if (arg.date.getDate() === 1) return { html: '1일' };
                return { html: '' };
            } else if (arg.level === 0) { 
                if (arg.date.getMonth() === 0) {
                    return { html: `<span style="color:#ffffff !important; font-weight:bold;">${arg.text}</span>` };
                }
            }
        },
        slotLabelDidMount: function(arg) {
            // [연도/월 구분선 미세복구 전용 (텍스트 조작 완전히 배제)]
            if (arg.date.getMonth() === 0) {
                arg.el.style.borderLeft = '1px solid rgba(255,255,255,0.15)'; 
                arg.el.style.background = 'transparent'; 
            }
        }, 
        resourceAreaWidth: getDynamicResourceWidth(), // 동적 계산 길이 매핑
        resourceAreaHeaderContent: '프로젝트',
        locale: 'ko',
        headerToolbar: {
            left: '', // 추가 버튼 삭제
            right: 'prev,next today'
        },
        buttonText: { today: '오늘' },
        resources: customProjects.map((p, idx) => ({ id: p.id, title: p.name, eventColor: p.color, order: idx })),
        resourceOrder: 'order', // 이름순 정렬 해제 및 배열 인덱스 기반 정렬 고정
        events: [],
        editable: true,
        nowIndicator: true, // [추가] 오늘 날짜/시간 현재선 가이드 표시
        selectable: true,
        droppable: true, // 서브 캘린더 드래그 허용
        eventReceive: function(info) {
            const ev = info.event;
            const matrixId = ev.id; 
            const title = ev.title;
            const startStr = ev.startStr;
            
            const droppedProj = ev.getResources()[0] ? ev.getResources()[0].id : (customProjects.length > 0 ? customProjects[0].id : 'proj_default');
            
            ev.remove(); // 임시 자동 렌더 스텁 삭제
            
            openEventModal(false, 'sub', true); // 저장위치 고정
            document.getElementById('eventTitle').value = title;
            document.getElementById('eventStart').value = startStr;
            const projectSelect = document.getElementById('eventProject');
            if(projectSelect) projectSelect.value = droppedProj;
            
            document.getElementById('pendingMatrixId').value = matrixId;
        },
        eventDisplay: 'block',
        eventContent: function(arg) {
            let title = arg.event.title;
            let type = arg.event.extendedProps.eventType;
            let projectCode = arg.event.extendedProps.project;
            let desc = arg.event.extendedProps.description || '';
            let timeStr = arg.event.extendedProps.eventTime || '';
            
            // 보조 캘린더 고유 날짜 정보 계산
            let start = arg.event.start;
            let dateText = '';
            if (start) {
                let sY = String(start.getFullYear()).slice(-2);
                let sMonth = start.getMonth() + 1;
                let sDay = start.getDate();
                let startStr = `${sY}.${sMonth}/${sDay}`;
                
                const isOngoing = arg.event.extendedProps && arg.event.extendedProps.isOngoing;
                if (isOngoing) {
                    dateText = startStr + ' ~ ';
                } else {
                    let endStr = startStr;
                    if (arg.event.end) {
                        let e = new Date(arg.event.end);
                        e.setDate(e.getDate() - 1); 
                        let eY = String(e.getFullYear()).slice(-2);
                        endStr = `${eY}.${e.getMonth() + 1}/${e.getDate()}`;
                    }
                    dateText = startStr === endStr ? startStr : startStr + ' ~ ' + endStr;
                }
            }

            let projColor = getProjectColor(projectCode);
            let badgeHtml = type ? `<span class="event-badge" style="background-color:rgba(255,255,255,0.2) !important; color:white !important;">${type}</span>` : '';
            let titleHtml = `<span style="font-weight:bold; font-size:15px;">${title}</span>`;
            let descHtml = desc ? `<span class="event-desc-text" style="font-size:14px;"> - ${desc}</span>` : '';
            let timeBadgeHtml = timeStr ? `<span style="background:rgba(255,255,255,0.25); padding:1px 5px; border-radius:4px; font-size:14px; margin-right:4px;"><i class="far fa-clock"></i> ${timeStr}</span>` : '';

            // 호버 시 나타나는 그룹에 시간, 상세설명, 날짜 포함
            let detailGroupHtml = `<span class="event-detail-group">${timeBadgeHtml}${descHtml} <span style="opacity:0.8; font-size:14px; font-weight:normal; margin-left:4px;">(${dateText})</span></span>`;

            // 서브 캘린더 전용: 왼쪽 색상 지시자 추가 (Bar 형식)
            let colorIndicatorHtml = `<div class="event-color-indicator" style="background-color: ${projColor};"></div>`;

            return { html: `<div class="custom-event has-indicator" style="padding:2px 4px;">${colorIndicatorHtml}${badgeHtml}<span class="event-title">${titleHtml}${detailGroupHtml}</span></div>` };
        },
        select: function(info) {
            openEventModal(false, 'sub', true); // 저장위치 고정
            if (info.resource) {
                document.getElementById('eventProject').value = info.resource.id;
            }
            document.getElementById('eventStart').value = info.startStr.split('T')[0];
            if (info.endStr) {
                const end = new Date(info.endStr);
                end.setDate(end.getDate() - 1);
                document.getElementById('eventEnd').value = formatDate(end);
            }
        },
        eventClick: function(info) {
            openEventModal(true, 'sub');
            const event = info.event;
            document.getElementById('eventId').value = event.id;
            document.getElementById('eventTitle').value = event.title;
            document.getElementById('eventType').value = event.extendedProps.eventType || '일반';
            document.getElementById('eventProject').value = event.getResources()[0] ? event.getResources()[0].id : event.extendedProps.project;
            document.getElementById('eventDescription').value = event.extendedProps.description || '';
            
            const isOngoing = event.extendedProps.isOngoing || false;
            document.getElementById('eventOngoing').checked = isOngoing;
            document.getElementById('eventEnd').disabled = isOngoing;
            document.getElementById('eventTime').value = event.extendedProps.eventTime || '';
            
            document.getElementById('eventStart').value = event.startStr.split('T')[0];
            if (event.end && !isOngoing) {
                const end = new Date(event.end);
                end.setDate(end.getDate() - 1);
                document.getElementById('eventEnd').value = formatDate(end);
            } else {
                document.getElementById('eventEnd').value = '';
            }
        },
        eventDrop: function(info) {
            const newResId = info.event.getResources()[0].id;
            info.event.setExtendedProp('project', newResId);
            // 서브 캘린더는 전체 배경을 프로젝트 색으로 칠하지 않고 중립색 유지 (왼쪽 지시자만 색상 적용)
            info.event.setProp('backgroundColor', 'rgba(51, 65, 85, 0.8)');
            updateSingleEventStore(info.event, 'sub');
        },
        eventResize: function(info) { updateSingleEventStore(info.event, 'sub'); }
    });
    subCalendar.render();

    if (isFirebaseActive) {
        db.collection("sub_events").onSnapshot((querySnapshot) => {
            savedSubEvents = [];
            querySnapshot.forEach((doc) => {
                let eventData = doc.data();
                eventData.id = doc.id;
                eventData.resourceId = eventData.extendedProps.project;
                // 서브 캘린더는 시각적 안정감을 위해 배경색을 중립색으로 통일 (지시자 별도 사용)
                eventData.backgroundColor = 'rgba(51, 65, 85, 0.8)';
                if (eventData.extendedProps) eventData.extendedProps.sortTime = getSortTimeVal(eventData.extendedProps.eventTime);
                eventData = applyOngoingDate(eventData);
                savedSubEvents.push(eventData);
            });
            subCalendar.removeAllEventSources();
            subCalendar.addEventSource(savedSubEvents);
            setTimeout(() => subCalendar.updateSize(), 50); // 비동기 렌더링 후 좌우 행 높이 동기화 강제 처리
        });
    } else {
        let localSubEvents = JSON.parse(localStorage.getItem('subCalendarEvents')) || [];
        localSubEvents.forEach(e => {
            e.resourceId = e.extendedProps.project;
            e.backgroundColor = 'rgba(51, 65, 85, 0.8)';
            if (e.extendedProps) e.extendedProps.sortTime = getSortTimeVal(e.extendedProps.eventTime);
            applyOngoingDate(e);
        });
        subCalendar.addEventSource(localSubEvents);
        setTimeout(() => subCalendar.updateSize(), 50); // 로컬 이벤트 렌더링 후 좌우 행 높이 동기화
    }

    // --- 3. 이벤트 모달 로직 (추가/수정/삭제) --- //
    const eventModal = document.getElementById('eventModal');
    const eventForm = document.getElementById('eventForm');
    const deleteBtn = document.getElementById('deleteEventBtn');
    
    document.getElementById('addEventBtn').addEventListener('click', () => {
        openEventModal(false, 'main');
        const today = formatDate(new Date());
        document.getElementById('eventStart').value = today;
    });

    // addSubEventBtn는 FullCalendar 네이티브 customButton으로 대체되었습니다.

    // [추가] 모달 내 탭 호환성 동기화 (종류에 맞게 항목 숨김처리)
    function updateModalUIConfigs(calType) {
        const timeGrp = document.getElementById('timeInputGroup');
        const ongoingGrp = document.getElementById('ongoingContainer');
        const importantGrp = document.getElementById('importantInputGroup');
        const endInput = document.getElementById('eventEnd');
        const ongoingCb = document.getElementById('eventOngoing');
        const importantCb = document.getElementById('eventImportant');
        const timeInput = document.getElementById('eventTime');
        
        if (calType === 'sub') {
            if (timeGrp) timeGrp.style.display = 'none';
            if (importantGrp) importantGrp.style.display = 'none';
            if (ongoingGrp) ongoingGrp.style.display = 'flex';
            if (timeInput) timeInput.value = ''; // 서브캘린더 시간 미지원 초기화
        } else {
            if (timeGrp) timeGrp.style.display = 'block';
            if (importantGrp) importantGrp.style.display = 'block';
            if (ongoingGrp) ongoingGrp.style.display = 'none';
            if (ongoingCb) ongoingCb.checked = false;
            if (endInput) endInput.disabled = false;
        }
    }

    const tSelect = document.getElementById('eventTargetCalendar');
    if (tSelect) {
        tSelect.addEventListener('change', (e) => updateModalUIConfigs(e.target.value));
    }

    // [추가] 오전/오후 30분 단위 선택 옵션 프로그래매틱 주입
    const timeSelectMenu = document.getElementById('eventTime');
    if (timeSelectMenu) {
        for(let i=0; i<48; i++) {
            let h = Math.floor(i / 2);
            let m = i % 2 === 0 ? '00' : '30';
            let ampm = h < 12 ? '오전' : '오후';
            let displayH = h % 12 === 0 ? 12 : h % 12;
            let displayStr = `${ampm} ${displayH}:${m}`;
            timeSelectMenu.innerHTML += `<option value="${displayStr}">${displayStr}</option>`;
        }
    }

    function openEventModal(isEditing = false, targetCalendar = 'main', lockTarget = false) {
        eventModal.classList.remove('hidden');
        
        const ongoingCb = document.getElementById('eventOngoing');
        const endInput = document.getElementById('eventEnd');
        
        // 폼 초기화를 가장 먼저 수행하여, 뒤이어 JS로 세팅하는 값(저장위치 등)이 하드 리셋에 의해 증발하는 버그 방지
        if (!isEditing) {
            eventForm.reset();
            document.getElementById('eventId').value = '';
            if(ongoingCb) ongoingCb.checked = false;
            const importantCb = document.getElementById('eventImportant');
            if(importantCb) importantCb.checked = false;
            if(endInput) endInput.disabled = false;
        }
        
        const targetSelect = document.getElementById('eventTargetCalendar');
        if (targetSelect) {
            targetSelect.value = targetCalendar;
            targetSelect.disabled = isEditing || lockTarget;
            updateModalUIConfigs(targetCalendar); // 렌더 훅 후크 바인딩 업데이트 강제
        }
        
        if (isEditing) {
            document.getElementById('modalTitle').textContent = '일정 수정';
            deleteBtn.classList.remove('hidden');
        } else {
            document.getElementById('modalTitle').textContent = '새로운 일정 추가';
            deleteBtn.classList.add('hidden');
            
            if(customProjects.length > 0) {
                document.getElementById('eventProject').value = customProjects[0].id; // 첫번째 프로젝트 기본값
            }
        }
    }

    function closeEventModal() {
        eventModal.classList.add('hidden');
        eventForm.reset();
        document.getElementById('eventId').value = '';
        const pendingMtx = document.getElementById('pendingMatrixId');
        if(pendingMtx) pendingMtx.value = '';
    }

    document.getElementById('closeModal').addEventListener('click', closeEventModal);
    eventModal.addEventListener('click', (e) => { if (e.target === eventModal) closeEventModal(); });

    // 진행 중(Ongoing) 체크박스 동작 리스너 바인딩
    const ongoingCheckbox = document.getElementById('eventOngoing');
    if (ongoingCheckbox) {
        ongoingCheckbox.addEventListener('change', (e) => {
            const endInp = document.getElementById('eventEnd');
            if (endInp) {
                endInp.disabled = e.target.checked;
                if (e.target.checked) endInp.value = '';
            }
        });
    }

    eventForm.addEventListener('submit', function(e) {
        e.preventDefault();
        console.log("💾 일정 저장 프로세스 시작...");
        
        try {
            const title = document.getElementById('eventTitle').value.trim();
        const start = document.getElementById('eventStart').value;
        const end = document.getElementById('eventEnd').value;
        const project = document.getElementById('eventProject').value;
        const eventType = document.getElementById('eventType').value;
        const description = document.getElementById('eventDescription').value.trim();
        const eventTime = document.getElementById('eventTime').value;
        const id = document.getElementById('eventId').value;

        if (!title || !start) return;
        if(end && new Date(end) < new Date(start)) {
            alert('종료일은 시작일 이후여야 합니다.');
            return;
        }

        let calendarEnd = null;
        const isOngoing = document.getElementById('eventOngoing').checked;
        const isImportant = document.getElementById('eventImportant').checked;
        
        if (isOngoing) {
            // 진행 중인 일정이면 캘린더 엔진상 가상의 종료일을 내일 자정으로 처리 (오늘까지 계속 그려지도록)
            const endDate = new Date();
            endDate.setDate(endDate.getDate() + 1);
            calendarEnd = formatDate(endDate);
        } else if (end) {
            const endDate = new Date(end);
            endDate.setDate(endDate.getDate() + 1);
            calendarEnd = formatDate(endDate);
        }

        const currentTargetCalendar = document.getElementById('eventTargetCalendar').value;
        const collectionName = currentTargetCalendar === 'sub' ? "sub_events" : "events";
        const targetCalInstance = currentTargetCalendar === 'sub' ? subCalendar : calendar;
        
        console.log("📍 저장 위치:", currentTargetCalendar, "| 컬렉션:", collectionName);
        if (!targetCalInstance) {
            throw new Error("대상 캘린더 인스턴스를 찾을 수 없습니다. (subCalendar/calendar 확인 필요)");
        }
        
        let finalBgColor = 'rgba(51, 65, 85, 0.8)';

        const newEventData = {
            title: title,
            start: start,
            end: calendarEnd,
            resourceId: currentTargetCalendar === 'sub' ? project : undefined,
            extendedProps: { 
                project, eventType, description, isOngoing, isImportant, eventTime,
                sortTime: getSortTimeVal(eventTime)
            },
            backgroundColor: finalBgColor,
            borderColor: finalBgColor
        };

        if (isFirebaseActive && db) {
            console.log(`📡 Firebase [${collectionName}]에 데이터 전송 중...`);
            if (id) {
                db.collection(collectionName).doc(id).update(newEventData);
            } else {
                db.collection(collectionName).add(newEventData);
            }
        } else {
            console.log("💾 로컬 모드 (LocalStorage) 데이터 저장 중...");
            if (id) {
                const event = targetCalInstance.getEventById(id);
                if(event) {
                    event.setProp('title', title);
                    event.setStart(start);
                    event.setEnd(calendarEnd);
                    if (currentTargetCalendar === 'sub') event.setResources([project]);
                    event.setExtendedProp('project', project);
                    event.setExtendedProp('eventType', eventType);
                    event.setExtendedProp('description', description);
                    event.setExtendedProp('isOngoing', isOngoing);
                    event.setExtendedProp('isImportant', isImportant);
                    event.setExtendedProp('eventTime', eventTime);
                    event.setProp('backgroundColor', 'rgba(51, 65, 85, 0.8)');
                    event.setProp('borderColor', 'rgba(51, 65, 85, 0.8)');
                }
            } else {
                targetCalInstance.addEvent({ ...newEventData, id: Date.now().toString() });
            }
            if (currentTargetCalendar === 'sub') updateLocalSubEventStore();
            else updateLocalEventStore();
        }

        const pendingMtxId = document.getElementById('pendingMatrixId').value;
        if (pendingMtxId && window.deleteMatrixTask) {
            window.deleteMatrixTask(pendingMtxId, true);
        }

        console.log("✅ 저장 완료 및 모달 닫기");
        closeEventModal();

        } catch (error) {
            console.error("❌ 일정 저장 중 에러 발생:", error);
            alert("일정 저장 중 오류가 발생했습니다. 브라우저 콘솔을 확인해 주세요.");
        }
    });

    deleteBtn.addEventListener('click', () => {
        if(confirm('이 일정을 삭제하시겠습니까?')) {
            const id = document.getElementById('eventId').value;
            const targetCalendar = document.getElementById('eventTargetCalendar').value;
            const collectionName = targetCalendar === 'sub' ? "sub_events" : "events";
            const targetCalInstance = targetCalendar === 'sub' ? subCalendar : calendar;

            if (isFirebaseActive && id) {
                db.collection(collectionName).doc(id).delete();
            } else {
                const event = targetCalInstance.getEventById(id);
                if (event) {
                    event.remove();
                    if (targetCalendar === 'sub') updateLocalSubEventStore();
                    else updateLocalEventStore();
                }
            }
            closeEventModal();
        }
    });

    // 드래그/리사이즈 연동 함수
    function updateSingleEventStore(eventObj, targetCalendar = 'main') {
        const collectionName = targetCalendar === 'sub' ? "sub_events" : "events";
        if (isFirebaseActive) {
            db.collection(collectionName).doc(eventObj.id).update({
                start: eventObj.startStr,
                end: eventObj.endStr || null,
                extendedProps: eventObj.extendedProps,
                backgroundColor: eventObj.backgroundColor,
                resourceId: targetCalendar === 'sub' ? (eventObj.getResources()[0] ? eventObj.getResources()[0].id : null) : undefined
            });
        } else {
            if (targetCalendar === 'sub') updateLocalSubEventStore();
            else updateLocalEventStore();
        }
    }

    function updateLocalEventStore() {
        const eventsData = calendar.getEvents().map(e => ({
            id: e.id,
            title: e.title,
            start: e.startStr,
            end: e.endStr || null,
            extendedProps: e.extendedProps,
            backgroundColor: e.backgroundColor
        }));
        localStorage.setItem('calendarEvents', JSON.stringify(eventsData));
    }

    function updateLocalSubEventStore() {
        if(!subCalendar) return;
        const eventsData = subCalendar.getEvents().map(e => ({
            id: e.id,
            title: e.title,
            start: e.startStr,
            end: e.endStr || null,
            extendedProps: e.extendedProps,
            backgroundColor: e.backgroundColor
        }));
        localStorage.setItem('subCalendarEvents', JSON.stringify(eventsData));
    }


    // --- 4. 필터 로직 --- //
    function bindFilterCheckboxes() {
        const checkboxes = document.querySelectorAll('.filter-chk');
        checkboxes.forEach(cb => { cb.addEventListener('change', applyFilters); });
    }

    function applyFilters() {
        const checkboxes = document.querySelectorAll('.filter-chk');
        const activeProjects = Array.from(checkboxes)
                                   .filter(cb => cb.checked)
                                   .map(cb => cb.value);
        
        calendar.getEvents().forEach(evt => {
            const proj = evt.extendedProps.project;
            evt.setProp('display', activeProjects.includes(proj) ? 'block' : 'none');
        });

        if (subCalendar) {
            subCalendar.getEvents().forEach(evt => {
                const proj = evt.extendedProps.project;
                evt.setProp('display', activeProjects.includes(proj) ? 'block' : 'none');
            });
        }
    }

    // --- 5. 캘린더 명칭 관리 (에디터) 모달 --- //
    const projModal = document.getElementById('projectManageModal');
    const newProjColors = ['#f59e0b', '#06b6d4', '#8b5cf6', '#10b981', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6'];
    
    function renderProjectEditList() {
        const container = document.getElementById('projectEditContainer');
        
        // 브라우저 네이티브 컬러 피커용 추천(표준) 색상표 제공 (datalist)
        const dataListHtml = `
            <datalist id="presetColors">
                ${newProjColors.map(color => `<option value="${color}"></option>`).join('')}
            </datalist>
        `;
        
        container.innerHTML = dataListHtml;
        
        customProjects.forEach((proj) => {
            const abbrevVal = proj.abbrev || proj.name.substring(0, 2);
            container.innerHTML += `
                <div class="proj-edit-item" style="border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:12px; margin-bottom:12px;">
                    <label style="font-size:0.85rem; color:var(--text-secondary); display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
                        <span style="display:flex; align-items:center; gap:8px;">
                            <input type="color" id="edit_color_${proj.id}" value="${proj.color}" list="presetColors" style="width: 24px; height: 24px; border: none; padding: 0; cursor: pointer; border-radius: 4px; background: transparent;" title="색상 변경">
                            ID: ${proj.id}
                        </span>
                        <button type="button" class="text-btn remove-proj-btn" style="color:var(--color-issue);" data-id="${proj.id}">삭제</button>
                    </label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" id="edit_abbr_${proj.id}" class="form-group" style="margin-bottom:0; width:70px; border:none; padding:10px; border-radius:6px; background:rgba(0,0,0,0.2); color:white; text-align:center;" value="${abbrevVal}" placeholder="축약" title="이벤트 막대 배지 표시용 짧은 이름">
                        <input type="text" id="edit_input_${proj.id}" class="form-group" style="margin-bottom:0; flex:1; border:none; padding:10px; border-radius:6px; background:rgba(0,0,0,0.2); color:white;" value="${proj.name}" placeholder="캘린더(프로젝트) 전체 명칭">
                    </div>
                </div>
            `;
        });
        
        document.querySelectorAll('.remove-proj-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const pid = e.target.getAttribute('data-id');
                if(confirm('이 카테고리를 삭제하시겠습니까? (기존 일정 데이터는 유지됩니다)')) {
                    customProjects = customProjects.filter(p => p.id !== pid);
                    renderProjectEditList();
                }
            });
        });
    }

    // 명칭 편집 버튼 안정성 보강
    const manageBtn = document.getElementById('manageProjectsBtn');
    if (manageBtn) {
        manageBtn.addEventListener('click', () => {
            console.log("명칭 편집 버튼 클릭됨");
            renderProjectEditList();
            projModal.classList.remove('hidden');
        });
    } else {
        console.error("명칭 편집 버튼(manageProjectsBtn)을 찾을 수 없습니다.");
    }

    document.getElementById('addNewProjectBtn').addEventListener('click', () => {
        const newId = 'proj_' + Math.random().toString(36).substr(2, 9); // 파이어베이스 안전한 랜덤아이디
        const rdColor = newProjColors[customProjects.length % newProjColors.length];
        customProjects.push({ id: newId, name: '새 카테고리', abbrev: '새', color: rdColor });
        renderProjectEditList();
    });

    document.getElementById('closeProjModal').addEventListener('click', () => {
        projModal.classList.add('hidden');
    });

    document.getElementById('saveProjectsBtn').addEventListener('click', () => {
        customProjects.forEach(proj => {
            const input = document.getElementById(`edit_input_${proj.id}`);
            const abbrInput = document.getElementById(`edit_abbr_${proj.id}`);
            const colorInput = document.getElementById(`edit_color_${proj.id}`);
            if(input && input.value.trim() !== '') {
                proj.name = input.value.trim();
            }
            if(abbrInput) {
                proj.abbrev = abbrInput.value.trim();
            }
            if(colorInput) {
                proj.color = colorInput.value;
            }
        });
        
        // [메인 캘린더 기존 등록일정 배경색 일괄 갱신]
        calendar.getEvents().forEach(evt => {
            evt.setProp('backgroundColor', 'rgba(51, 65, 85, 0.8)');
            evt.setProp('borderColor', 'rgba(51, 65, 85, 0.8)');
        });
        
        if (subCalendar) {
            subCalendar.getEvents().forEach(evt => {
                const projId = evt.extendedProps.project;
                const updatedProj = customProjects.find(p => p.id === projId);
                if (updatedProj) {
                    evt.setProp('backgroundColor', updatedProj.color);
                    evt.setProp('borderColor', updatedProj.color);
                }
            });
        }
        
        if (isFirebaseActive) {
            db.collection("config").doc("projects").set({ list: customProjects });
            // (파이어베이스 구동 시 개별 이벤트 bulk update 로직 추가 요망)
        } else {
            localStorage.setItem('customProjects', JSON.stringify(customProjects));
            renderProjectsUI();
            applyFilters(); 
            
            if(subCalendar) {
                // 기존 문제 원인: Resource를 통째로 삭제(r.remove())하면 타임라인 엔진이 연결된 과거/기존 일정들을 UI상에서 분리시켜버려 색상이 증발하는 렌더링 버그 발생.
                // 해결: in-place 업데이트 방식으로 기존 요소를 안전하게 유지하며 명칭/색상 속성값(Prop)만 부분 교체.
                // 기존 요소 순서 및 옵션 인플레이스 재정렬
                customProjects.forEach((p, idx) => {
                    const res = subCalendar.getResourceById(p.id);
                    if (res) {
                        res.setProp('title', p.name);
                        res.setProp('eventColor', p.color);
                        res.setProp('order', idx);
                    } else {
                        subCalendar.addResource({ id: p.id, title: p.name, eventColor: p.color, order: idx });
                    }
                });
                
                // 삭제 완료된 행(Resource) 지우기
                subCalendar.getResources().forEach(r => {
                    if (!customProjects.find(p => p.id === r.id)) {
                        r.remove();
                    }
                });
            }
            
            // 색상이 업데이트된 일정 배열 자체를 로컬 스토리지에 재저장하여 새로고침 시에도 유지되게 강제
            updateLocalEventStore();
            updateLocalSubEventStore();
        }
        
        projModal.classList.add('hidden');
        alert('카테고리가 성공적으로 저장/변경되었습니다.');
    });

    // =========================================================================
    //   아이젠하워 매트릭스 로직 (미정 할 일 관리 및 D&D)
    // =========================================================================

    const matrixDrawer = document.getElementById('matrixDrawer');
    const matrixOverlay = document.getElementById('matrixOverlay');
    const toggleMatrixBtn = document.getElementById('toggleMatrixBtn');
    const closeMatrixBtn = document.getElementById('closeMatrixBtn');
    const addMatrixTaskBtn = document.getElementById('addMatrixTaskBtn');
    const matrixTaskInput = document.getElementById('matrixTaskInput');
    const matrixQuadrantSelect = document.getElementById('matrixQuadrantSelect');

    function saveMatrixTasks() {
        localStorage.setItem('matrixTasks', JSON.stringify(matrixTasks));
    }

    // 전역(window) 함수 등록으로 HTML 인라인 핸들러(onclick) 내부 호출 허용
    window.deleteMatrixTask = function(id, skipConfirm = false) {
        if (!skipConfirm && !confirm('해당 미설정 할 일을 포기/삭제 하시겠습니까?')) return;
        matrixTasks = matrixTasks.filter(t => t.id !== id);
        saveMatrixTasks();
        renderMatrixTasks();
    };

    function renderMatrixTasks() {
        ['q1', 'q2', 'q3', 'q4'].forEach(q => {
            const listEl = document.getElementById(`${q}List`);
            if(!listEl) return;
            listEl.innerHTML = '';
            
            const tasksInQ = matrixTasks.filter(t => t.quadrant === q);
            tasksInQ.forEach(task => {
                const item = document.createElement('div');
                item.className = 'matrix-item fc-event'; // 드래그 가능 속성 연결(FullCalendar ThirdPartyDraggable 호환성)
                item.dataset.id = task.id;
                item.dataset.title = task.title;
                item.innerHTML = `
                    <div class="matrix-item-content" title="${task.title}">${task.title}</div>
                    <button class="matrix-item-delete" onclick="window.deleteMatrixTask('${task.id}')"><i class="fas fa-trash"></i></button>
                `;
                listEl.appendChild(item);
            });
        });
    }

    if (addMatrixTaskBtn) {
        addMatrixTaskBtn.addEventListener('click', () => {
            const title = matrixTaskInput.value.trim();
            if (!title) return;
            const newTask = {
                id: 'mtx_' + Date.now(),
                title: title,
                quadrant: matrixQuadrantSelect.value
            };
            matrixTasks.push(newTask);
            saveMatrixTasks();
            renderMatrixTasks();
            matrixTaskInput.value = '';
        });
    }
    
    if (matrixTaskInput) {
        matrixTaskInput.addEventListener('keypress', (e) => {
            if(e.key === 'Enter') addMatrixTaskBtn.click();
        });
    }

    if (toggleMatrixBtn) {
        toggleMatrixBtn.addEventListener('click', () => {
            matrixDrawer.classList.add('active');
            matrixOverlay.classList.add('active');
            renderMatrixTasks();
        });
    }

    const closeMatrix = () => {
        matrixDrawer.classList.remove('active');
        matrixOverlay.classList.remove('active');
    };
    if (closeMatrixBtn) closeMatrixBtn.addEventListener('click', closeMatrix);
    if (matrixOverlay) matrixOverlay.addEventListener('click', closeMatrix);

    // Draggable 플러그인 초기화 (외부 DOM 요소를 캘린더 엔진에 드래그 가능하게 바인딩)
    if (document.querySelector('.matrix-grid')) {
        new FullCalendar.Draggable(document.querySelector('.matrix-grid'), {
            itemSelector: '.matrix-item',
            eventData: function(eventEl) {
                return {
                    id: eventEl.dataset.id,
                    title: eventEl.dataset.title,
                    create: true // 달력 위에 드롭하는 즉시 새로운 Event 객체로 승격 생성
                };
            }
        });
    }

    renderMatrixTasks(); // 브라우저 로딩 시 매트릭스 상태 초기 복원

});
