// --- Database Logic (IndexedDB) ---
const DB_NAME = 'VibeMusicDB';
const DB_VERSION = 2; // Incremented version
const STORE_NAME = 'songs';
const FOLDER_STORE = 'folders';

let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(FOLDER_STORE)) {
                db.createObjectStore(FOLDER_STORE, { keyPath: 'id', autoIncrement: true });
            }
        };
        request.onsuccess = (e) => {
            db = e.target.result;
            resolve(db);
        };
        request.onerror = (e) => reject(e.target.error);
    });
}

async function saveSong(songData) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(songData);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getAllSongs() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function deleteSongFromDB(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = (e) => reject(e.target.error);
    });
}

// Folder DB helpers
async function saveFolder(folderData) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([FOLDER_STORE], 'readwrite');
        const store = transaction.objectStore(FOLDER_STORE);
        const request = store.add(folderData);
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function getAllFolders() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([FOLDER_STORE], 'readonly');
        const store = transaction.objectStore(FOLDER_STORE);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = (e) => reject(e.target.error);
    });
}

async function deleteFolderFromDB(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([FOLDER_STORE, STORE_NAME], 'readwrite');
        const folderStore = transaction.objectStore(FOLDER_STORE);
        const songStore = transaction.objectStore(STORE_NAME);
        
        // Delete folder
        folderStore.delete(id);
        
        // Delete all songs in folder
        const request = songStore.getAll();
        request.onsuccess = () => {
            const songs = request.result;
            songs.forEach(song => {
                if (song.folderId === id) {
                    songStore.delete(song.id);
                }
            });
            resolve();
        };
    });
}

// --- Player Logic ---
const audio = new Audio();
let playlist = [];
let originalPlaylist = [];
let folders = [];
let currentIndex = -1;
let currentFolderId = null; // null means root
let isShuffle = false;
let isRepeat = false; 
let sleepTimer = null;
let sleepTimeRemaining = 0;
let isAllSelected = true;

const dom = {
    musicList: document.getElementById('music-list'),
    fileInput: document.getElementById('file-input'),
    addMusicBtn: document.getElementById('add-music-btn'),
    addFolderBtn: document.getElementById('add-folder-btn'),
    backBtn: document.getElementById('back-btn'),
    viewTitle: document.getElementById('view-title'),
    miniPlayer: document.getElementById('mini-player'),
    openPlayer: document.getElementById('open-player'),
    miniPlayPause: document.getElementById('mini-play-pause'),
    listView: document.getElementById('list-view'),
    playerView: document.getElementById('player-view'),
    closePlayer: document.getElementById('close-player'),
    mainPlayPause: document.getElementById('main-play-pause'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    progressBar: document.getElementById('progress-bar'),
    currentTime: document.getElementById('current-time'),
    totalTime: document.getElementById('total-time'),
    playerTitle: document.getElementById('player-title'),
    playerArtist: document.getElementById('player-artist'),
    shuffleBtn: document.getElementById('shuffle-btn'),
    repeatBtn: document.getElementById('repeat-btn'),
    shuffleAll: document.getElementById('shuffle-all'),
    playAll: document.getElementById('play-all'),
    searchInput: document.getElementById('search-input'),
    selectToggle: document.getElementById('select-toggle'),
    pwaInstall: document.getElementById('pwa-install'),
    sleepTimerBtn: document.getElementById('sleep-timer-btn'),
    sleepTimerDisplay: document.getElementById('sleep-timer-display')
};

// Initialization
async function init() {
    await initDB();
    const [songs, fetchedFolders] = await Promise.all([
        getAllSongs(),
        getAllFolders()
    ]);
    originalPlaylist = songs;
    folders = fetchedFolders;
    
    renderList();
    setupEventListeners();
}

function setupEventListeners() {
    dom.addMusicBtn.onclick = () => dom.fileInput.click();
    
    dom.addFolderBtn.onclick = async () => {
        const folderName = prompt('폴더 이름을 입력하세요:', '새 폴더');
        if (folderName && folderName.trim()) {
            const folderData = {
                name: folderName.trim(),
                createdAt: Date.now()
            };
            const id = await saveFolder(folderData);
            folderData.id = id;
            folders.push(folderData);
            renderList();
        }
    };

    dom.backBtn.onclick = () => {
        currentFolderId = null;
        renderList();
    };

    dom.fileInput.onchange = async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            const songData = {
                title: file.name.replace(/\.[^/.]+$/, ""),
                artist: '알 수 없는 아티스트',
                blob: file,
                addedAt: Date.now(),
                folderId: currentFolderId
            };
            const id = await saveSong(songData);
            songData.id = id;
            originalPlaylist.push(songData);
        }
        renderList();
        dom.fileInput.value = '';
    };

    // PWA Install Logic
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        dom.pwaInstall.classList.remove('hidden');
    });

    dom.pwaInstall.onclick = async () => {
        if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
                console.log('User accepted the install prompt');
            }
            deferredPrompt = null;
            dom.pwaInstall.classList.add('hidden');
        }
    };

    window.addEventListener('appinstalled', () => {
        dom.pwaInstall.classList.add('hidden');
        deferredPrompt = null;
    });

    dom.openPlayer.onclick = () => {
        dom.listView.classList.remove('active');
        dom.playerView.classList.add('active');
    };

    dom.closePlayer.onclick = () => {
        dom.playerView.classList.remove('active');
        dom.listView.classList.add('active');
    };

    dom.miniPlayPause.onclick = (e) => {
        e.stopPropagation();
        togglePlay();
    };

    dom.mainPlayPause.onclick = togglePlay;

    dom.nextBtn.onclick = () => playNext();
    dom.prevBtn.onclick = () => playPrev();

    let isDragging = false;

    dom.progressBar.onmousedown = () => isDragging = true;
    dom.progressBar.onmouseup = () => isDragging = false;
    dom.progressBar.ontouchstart = () => isDragging = true;
    dom.progressBar.ontouchend = () => isDragging = false;

    dom.progressBar.oninput = (e) => {
        if (!isNaN(audio.duration)) {
            const time = (e.target.value / 100) * audio.duration;
            dom.currentTime.textContent = formatTime(time);
        }
    };

    dom.progressBar.onchange = (e) => {
        if (!isNaN(audio.duration)) {
            const time = (e.target.value / 100) * audio.duration;
            audio.currentTime = time;
        }
    };

    audio.ontimeupdate = () => {
        if (!isNaN(audio.duration) && !isDragging) {
            const progress = (audio.currentTime / audio.duration) * 100;
            dom.progressBar.value = progress;
            dom.currentTime.textContent = formatTime(audio.currentTime);
            dom.totalTime.textContent = formatTime(audio.duration);
        }
    };

    audio.onended = () => {
        if (isRepeat) {
            audio.play();
        } else {
            playNext();
        }
    };

    dom.shuffleBtn.onclick = () => {
        isShuffle = !isShuffle;
        dom.shuffleBtn.classList.toggle('active', isShuffle);
        if (isShuffle) {
            shufflePlaylist();
        } else {
            playlist = [...originalPlaylist];
            // Find current song in the non-shuffled list
            if (currentIndex !== -1) {
                const currentId = playlist[currentIndex].id; // this logic is slightly flawed if we just revert, need better mapping
            }
        }
    };

    dom.repeatBtn.onclick = () => {
        isRepeat = !isRepeat;
        dom.repeatBtn.classList.toggle('active', isRepeat);
    };

    dom.shuffleAll.onclick = () => {
        isShuffle = true;
        dom.shuffleBtn.classList.add('active');
        
        // Filter by checked items if any are checked
        const checkedSongs = getCheckedSongs();
        if (checkedSongs.length > 0) {
            playlist = [...checkedSongs];
        } else {
            playlist = [...originalPlaylist];
        }
        
        shufflePlaylist();
        playSong(0);
        
        // 즉시 플레이어 화면으로 전환
        dom.listView.classList.remove('active');
        dom.playerView.classList.add('active');
    };

    dom.playAll.onclick = () => {
        isShuffle = false;
        dom.shuffleBtn.classList.remove('active');
        
        const checkedSongs = getCheckedSongs();
        if (checkedSongs.length > 0) {
            playlist = [...checkedSongs];
        } else {
            playlist = [...originalPlaylist];
        }
        
        playSong(0);
        
        // 즉시 플레이어 화면으로 전환
        dom.listView.classList.remove('active');
        dom.playerView.classList.add('active');
    };

    dom.selectToggle.onclick = () => {
        isAllSelected = !isAllSelected;
        const checkboxes = document.querySelectorAll('.song-checkbox');
        checkboxes.forEach(cb => cb.checked = isAllSelected);
        dom.selectToggle.classList.toggle('active', isAllSelected);
    };

    dom.sleepTimerBtn.onclick = () => {
        if (sleepTimer) {
            clearTimeout(sleepTimer);
            sleepTimer = null;
            sleepTimeRemaining = 0;
            dom.sleepTimerBtn.classList.remove('active');
            dom.sleepTimerDisplay.classList.remove('active');
            alert('취침 예약이 취소되었습니다.');
        } else {
            const minutes = prompt('몇 분 뒤에 음악을 끌까요? (숫자만 입력)', '30');
            if (minutes && !isNaN(minutes)) {
                const ms = minutes * 60 * 1000;
                sleepTimeRemaining = minutes * 60;
                startSleepTimer();
                sleepTimer = setTimeout(() => {
                    audio.pause();
                    alert('취침 예약 시간이 되어 음악을 종료합니다.');
                    location.reload(); // Reset app
                }, ms);
                dom.sleepTimerBtn.classList.add('active');
                dom.sleepTimerDisplay.classList.add('active');
                updateTimerDisplay();
            }
        }
    };

    dom.searchInput.oninput = (e) => {
        renderList();
    };
}

function renderList() {
    const query = dom.searchInput.value.toLowerCase();
    dom.musicList.innerHTML = '';
    
    // Update Header
    if (currentFolderId === null) {
        dom.viewTitle.textContent = '내 음악';
        dom.backBtn.classList.add('hidden');
    } else {
        const currentFolder = folders.find(f => f.id === currentFolderId);
        dom.viewTitle.textContent = currentFolder ? currentFolder.name : '폴더';
        dom.backBtn.classList.remove('hidden');
    }

    // Filter Items
    let filteredSongs = originalPlaylist;
    if (query) {
        filteredSongs = originalPlaylist.filter(s => 
            s.title.toLowerCase().includes(query) || 
            s.artist.toLowerCase().includes(query)
        );
    } else {
        // If no search, filter by current folder
        filteredSongs = originalPlaylist.filter(s => s.folderId === currentFolderId);
    }

    // Render Folders (only in root and when not searching)
    if (currentFolderId === null && !query) {
        folders.forEach(folder => {
            const songCount = originalPlaylist.filter(s => s.folderId === folder.id).length;
            const div = document.createElement('div');
            div.className = 'folder-item';
            div.innerHTML = `
                <div class="folder-icon"><i class="fas fa-folder"></i></div>
                <div class="folder-info">
                    <span class="folder-name">${folder.name}</span>
                    <span class="folder-count">곡 ${songCount}개</span>
                </div>
                <button class="delete-btn folder-del" data-id="${folder.id}"><i class="fas fa-trash"></i></button>
            `;
            div.onclick = (e) => {
                if (e.target.closest('.delete-btn')) return;
                currentFolderId = folder.id;
                renderList();
            };
            
            const delBtn = div.querySelector('.folder-del');
            delBtn.onclick = async (e) => {
                e.stopPropagation();
                if (confirm(`'${folder.name}' 폴더와 그 안의 모든 음악을 삭제하시겠습니까?`)) {
                    await deleteFolderFromDB(folder.id);
                    folders = folders.filter(f => f.id !== folder.id);
                    originalPlaylist = originalPlaylist.filter(s => s.folderId !== folder.id);
                    renderList();
                }
            };
            dom.musicList.appendChild(div);
        });
    }

    // Render Songs
    if (filteredSongs.length === 0 && (currentFolderId !== null || query || folders.length === 0)) {
        if (dom.musicList.children.length === 0) {
            dom.musicList.innerHTML = `
                <li class="empty-state">
                    <i class="fas fa-music"></i>
                    <p>항목이 없습니다.</p>
                </li>`;
        }
        return;
    }

    filteredSongs.forEach((song, index) => {
        const isActive = currentIndex !== -1 && playlist[currentIndex] && playlist[currentIndex].id === song.id;
        const li = document.createElement('li');
        li.className = `music-item ${isActive ? 'active' : ''}`;
        li.innerHTML = `
            <input type="checkbox" class="song-checkbox" data-id="${song.id}" ${isAllSelected ? 'checked' : ''}>
            <div class="item-info">
                <div style="display: flex; align-items: center;">
                    <span class="item-title">${song.title}</span>
                    ${isActive ? `
                        <div class="equalizer">
                            <div class="equalizer-bar"></div>
                            <div class="equalizer-bar"></div>
                            <div class="equalizer-bar"></div>
                        </div>
                    ` : ''}
                </div>
                <span class="item-artist">${song.artist}</span>
            </div>
            <button class="delete-btn" data-id="${song.id}"><i class="fas fa-trash"></i></button>
        `;
        li.onclick = (e) => {
            if (e.target.closest('.delete-btn') || e.target.closest('.song-checkbox')) return;
            playlist = filteredSongs; 
            playSong(index);
            // 즉시 플레이어 화면으로 전환
            dom.listView.classList.remove('active');
            dom.playerView.classList.add('active');
        };
        
        const delBtn = li.querySelector('.delete-btn');
        delBtn.onclick = async (e) => {
            e.stopPropagation();
            await deleteSongFromDB(song.id);
            originalPlaylist = originalPlaylist.filter(s => s.id !== song.id);
            renderList();
        };
        
        dom.musicList.appendChild(li);
    });
}

function getCheckedSongs() {
    const checkboxes = document.querySelectorAll('.song-checkbox:checked');
    const checkedIds = Array.from(checkboxes).map(cb => parseInt(cb.dataset.id));
    return originalPlaylist.filter(s => checkedIds.includes(s.id));
}

function playSong(index) {
    if (index < 0 || index >= playlist.length) return;
    
    currentIndex = index;
    const song = playlist[currentIndex];
    
    // Create URL from blob
    if (audio.src) URL.revokeObjectURL(audio.src);
    audio.src = URL.createObjectURL(song.blob);
    audio.play();

    updateUI(song);
    renderList(); // Update list to show active state
    dom.miniPlayer.classList.remove('hidden');
}

function togglePlay() {
    if (audio.paused) {
        audio.play();
    } else {
        audio.pause();
    }
    const icon = audio.paused ? 'fa-play' : 'fa-pause';
    dom.miniPlayPause.innerHTML = `<i class="fas ${icon}"></i>`;
    dom.mainPlayPause.innerHTML = `<i class="fas ${icon}"></i>`;
}

audio.onplay = () => {
    dom.miniPlayPause.innerHTML = `<i class="fas fa-pause"></i>`;
    dom.mainPlayPause.innerHTML = `<i class="fas fa-pause"></i>`;
    document.getElementById('player-album-art').style.transform = 'scale(1.05)';
};

audio.onpause = () => {
    dom.miniPlayPause.innerHTML = `<i class="fas fa-play"></i>`;
    dom.mainPlayPause.innerHTML = `<i class="fas fa-play"></i>`;
    document.getElementById('player-album-art').style.transform = 'scale(1)';
};

function playNext() {
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) nextIndex = 0;
    playSong(nextIndex);
}

function playPrev() {
    let prevIndex = currentIndex - 1;
    if (prevIndex < 0) prevIndex = playlist.length - 1;
    playSong(prevIndex);
}

function shufflePlaylist() {
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
}

function updateUI(song) {
    dom.playerTitle.textContent = song.title;
    dom.playerArtist.textContent = song.artist;
    document.querySelector('.mini-title').textContent = song.title;
    document.querySelector('.mini-artist').textContent = song.artist;
}

function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec < 10 ? '0' : ''}${sec}`;
}

function updateTimerDisplay() {
    if (sleepTimeRemaining > 0) {
        const min = Math.floor(sleepTimeRemaining / 60);
        const sec = sleepTimeRemaining % 60;
        dom.sleepTimerDisplay.textContent = `${min}:${sec < 10 ? '0' : ''}${sec}`;
    }
}

function startSleepTimer() {
    const interval = setInterval(() => {
        if (sleepTimeRemaining > 0) {
            sleepTimeRemaining--;
            updateTimerDisplay();
        } else {
            clearInterval(interval);
        }
    }, 1000);
}

init();
