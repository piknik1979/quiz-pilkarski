// Bezpieczna inicjalizacja klienta Supabase
if (!window.supabaseClient) {
    window.supabaseClient = window.supabase.createClient(
      CONFIG.SUPABASE_URL,
      CONFIG.SUPABASE_KEY
    );
  }
  const supabaseClient = window.supabaseClient;
  
  // Stan gry
  let currentQuestions = [];
  let currentIndex = 0;
  let score = 0;
  let correctAnswersCount = 0;
  let selectedDifficulty = 'mix';
  let timer = null;
  let timeLeft = CONFIG.QUESTION_TIME || 15;
  
  // Unikalne ID urządzenia gracza
  let deviceId = localStorage.getItem('football_quiz_device_id');
  if (!deviceId) {
    deviceId = 'user_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('football_quiz_device_id', deviceId);
  }
  
  // Elementy DOM
  const startScreen = document.getElementById('start-screen');
  const quizScreen = document.getElementById('quiz-screen');
  const resultScreen = document.getElementById('summary-screen') || document.getElementById('result-screen');
  const leaderboardScreen = document.getElementById('leaderboard-screen');
  
  const startBtn = document.getElementById('start-btn');
  const leaderboardBtn = document.getElementById('leaderboard-btn');
  const restartBtn = document.getElementById('restart-btn');
  const backToStartBtn = document.getElementById('back-to-menu-btn') || document.getElementById('back-to-start-btn');
  const saveScoreBtn = document.getElementById('save-score-btn');
  const themeToggle = document.getElementById('theme-toggle-btn') || document.getElementById('theme-toggle');
  
  // Dolna nawigacja
  const navHome = document.getElementById('nav-home');
  const navLeaderboard = document.getElementById('nav-leaderboard');
  
  const questionText = document.getElementById('question-text');
  const answersContainer = document.getElementById('answers-container');
  const questionCounter = document.getElementById('question-number') || document.getElementById('question-counter');
  const scoreDisplay = document.getElementById('score-counter') || document.getElementById('score-display');
  const finalScoreText = document.getElementById('final-score') || document.getElementById('final-score-text');
  const bonusInfoText = document.getElementById('summary-message') || document.getElementById('bonus-info-text');
  const playerNickname = document.getElementById('nickname-input') || document.getElementById('player-nickname');
  const leaderboardList = document.getElementById('leaderboard-list');
  const timerBar = document.getElementById('timer-bar') || document.getElementById('progress-bar');
  const timerText = document.getElementById('timer');
  const diffButtons = document.querySelectorAll('.diff-btn');
  const filterButtons = document.querySelectorAll('.filter-btn');
  
  // --- MOTYW (DZIEŃ / NOC) ---
  const savedTheme = localStorage.getItem('football_quiz_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  if (themeToggle) themeToggle.textContent = savedTheme === 'light' ? '☀️' : '🌙';
  
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('football_quiz_theme', newTheme);
        themeToggle.textContent = newTheme === 'dark' ? '🌙' : '☀️';
    });
  }
  
  // --- WYBÓR TRUDNOŚCI ---
  diffButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        diffButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedDifficulty = btn.getAttribute('data-diff');
    });
  });
  
  // --- NAWIGACJA MIĘDZY EKRANAMI ---
  function showScreen(screen) {
    [startScreen, quizScreen, resultScreen, leaderboardScreen].forEach(s => {
        if (s) s.classList.remove('active');
    });
    if (screen) screen.classList.add('active');
  }
  
  if (navHome) {
    navHome.addEventListener('click', () => showScreen(startScreen));
  }
  if (navLeaderboard) {
    navLeaderboard.addEventListener('click', () => {
        loadLeaderboard('all');
        showScreen(leaderboardScreen);
    });
  }
  
  // --- START QUIZU (Pobieranie pytań z Supabase z pełną paginacją) ---
  if (startBtn) {
    startBtn.addEventListener('click', async () => {
        startBtn.disabled = true;
        startBtn.textContent = 'Ładowanie pytań... ⚽';
  
        try {
            if (!supabaseClient) {
                throw new Error("Klient Supabase nie został zainicjalizowany.");
            }

            console.log("Pobieranie pytań z tabeli:", CONFIG.SUPABASE_TABLE);
            
            let allData = [];
            let from = 0;
            let step = 1000;
            let keepFetching = true;

            while (keepFetching) {
                const { data: chunkData, error, status } = await supabaseClient
                    .from(CONFIG.SUPABASE_TABLE)
                    .select('*')
                    .range(from, from + step - 1);
            
                if (error) throw error;

                if (chunkData && chunkData.length > 0) {
                    allData = allData.concat(chunkData);
                    if (chunkData.length < step) {
                        keepFetching = false;
                    } else {
                        from += step;
                    }
                } else {
                    keepFetching = false;
                }
                
                if (from >= 5000) keepFetching = false; // Bezpiecznik limitu
            }

            const data = allData;
            console.log("Łączna liczba pobranych pytań z całej bazy:", data.length);

            if (!data || data.length === 0) {
                console.warn('Tabela w bazie jest całkowicie pusta lub brak uprawnień!');
                alert('Brak pytań w bazie danych! Sprawdź czy tabela istnieje.');
                startBtn.disabled = false;
                startBtn.textContent = 'Rozpocznij Quiz 🚀';
                return;
            }
  
            let availableData = data;
            if (selectedDifficulty !== 'mix') {
                availableData = data.filter(q => q.difficulty && q.difficulty.toLowerCase().trim() === selectedDifficulty.toLowerCase().trim());
            }
  
            if (availableData.length === 0) {
                console.warn(`Brak pytań dla wybranego poziomu (${selectedDifficulty}), używam wszystkich dostępnych.`);
                availableData = data;
            }
  
            // --- INTELIGENTNE LOSOWANIE (Zapobieganie kumulacji tej samej kategorii) ---
            let shuffled = [...availableData].sort(() => Math.random() - 0.5);
            let selected = [];
            let categoriesUsed = {};

            for (let q of shuffled) {
                let cat = q.category || 'Inne';
                if (!categoriesUsed[cat]) categoriesUsed[cat] = 0;
                
                // Pozwól na maksymalnie 2 pytania z tej samej kategorii w jednym quizie
                if (categoriesUsed[cat] < 2 || selected.length >= 8) {
                    selected.push(q);
                    categoriesUsed[cat]++;
                }
                
                if (selected.length === 10) break;
            }

            // Jeśli zabrakło unikalnych, dobierz cokolwiek do 10
            if (selected.length < 10) {
                let remaining = shuffled.filter(q => !selected.includes(q));
                selected = selected.concat(remaining.slice(0, 10 - selected.length));
            }

            currentQuestions = selected.sort(() => Math.random() - 0.5);
            
            currentIndex = 0;
            score = 0;
            correctAnswersCount = 0;
            if (playerNickname) {
                playerNickname.value = "";
                playerNickname.disabled = false;
            }
            if (saveScoreBtn) saveScoreBtn.disabled = false;
  
            showScreen(quizScreen);
            nextQuestion();
        } catch (err) {
            console.error('Błąd szczegółowy Supabase:', err);
            alert('Wystąpił błąd połączenia z bazą: ' + (err.message || err));
        } finally {
            startBtn.disabled = false;
            startBtn.textContent = 'Rozpocznij Quiz 🚀';
        }
    });
  }
  
  // --- LOGIKA PYTAŃ I CZASU ---
  function nextQuestion() {
    if (currentIndex >= currentQuestions.length) {
        endQuiz();
        return;
    }
  
    clearInterval(timer);
    timeLeft = CONFIG.QUESTION_TIME || 15;
    updateTimerDisplay();
  
    const q = currentQuestions[currentIndex];
    if (questionCounter) questionCounter.textContent = `Pytanie ${currentIndex + 1}/${currentQuestions.length}`;
    if (scoreDisplay) scoreDisplay.textContent = score;
    if (questionText) questionText.textContent = q.question;
  
    const categoryTag = document.getElementById('category-tag');
    const beerDifficulty = document.getElementById('beer-difficulty');
    if (categoryTag) categoryTag.textContent = q.category ? `⚽ ${q.category}` : '⚽ Jagiellonia Białystok';
    
    if (beerDifficulty) {
        const diffVal = q.difficulty ? q.difficulty.toLowerCase().trim() : 'easy';
        beerDifficulty.className = `beer-difficulty ${diffVal}`;
        
        let diffNamePL = 'Łatwy';
        if (diffVal === 'medium') diffNamePL = 'Średni';
        if (diffVal === 'hard') diffNamePL = 'Trudny';
        
        beerDifficulty.textContent = `🍺 ${diffNamePL}`;
    }
  
   if (answersContainer) {
      answersContainer.innerHTML = '';
      
      let options = q.options;
      if (typeof options === 'string') {
          try {
              options = JSON.parse(options);
          } catch (e) {
              console.error("Nie udało się sparsować opcji:", q.options);
          }
      }
  
      if (!Array.isArray(options)) {
          console.error("Pytanie nie ma poprawnej tablicy opcji:", q);
          answersContainer.innerHTML = '<p style="color: red;">Błąd formatu odpowiedzi w tym pytaniu!</p>';
          return;
      }
  
      // --- LOSOWANIE KOLEJNOŚCI ODPOWIEDZI ---
      const correctOptionText = options[q.correct_index];
      const shuffledOptions = [...options].sort(() => Math.random() - 0.5);
      const newCorrectIndex = shuffledOptions.indexOf(correctOptionText);

      shuffledOptions.forEach((opt, index) => {
          const btn = document.createElement('button');
          btn.classList.add('answer-btn');
          btn.textContent = opt;
          btn.addEventListener('click', () => selectAnswer(index, newCorrectIndex));
          answersContainer.appendChild(btn);
      });
    }
    startTimer();
  }
  
  function startTimer() {
    timer = setInterval(() => {
        timeLeft--;
        updateTimerDisplay();
  
        if (timeLeft <= 0) {
            clearInterval(timer);
            handleTimeout();
        }
    }, 1000);
  }
  
  function updateTimerDisplay() {
    if (timerText) timerText.textContent = `${timeLeft}s`;
    if (timerBar) {
        const maxTime = CONFIG.QUESTION_TIME || 15;
        const percentage = (timeLeft / maxTime) * 100;
        timerBar.style.width = `${percentage}%`;
    }
  }
  
  function handleTimeout() {
    const q = currentQuestions[currentIndex];
    const correctIndex = q.correct_index;
    if (answersContainer) {
        const buttons = answersContainer.querySelectorAll('.answer-btn');
        buttons.forEach((btn, index) => {
            btn.disabled = true;
            if (index === correctIndex) btn.classList.add('correct');
        });
    }
  
    setTimeout(() => {
        currentIndex++;
        nextQuestion();
    }, 1500);
  }
  
  function selectAnswer(selectedIndex, correctIndex) {
    clearInterval(timer);
    if (!answersContainer) return;
    const buttons = answersContainer.querySelectorAll('.answer-btn');
    
    let points = 10;
    const q = currentQuestions[currentIndex];
    const diff = q.difficulty ? q.difficulty.trim().toLowerCase() : 'easy';
    if (diff === 'medium') points = 15;
    if (diff === 'hard') points = 20;
  
    buttons.forEach((btn, index) => {
        btn.disabled = true;
        if (index === correctIndex) {
            btn.classList.add('correct');
        } else if (index === selectedIndex) {
            btn.classList.add('incorrect');
        }
    });
  
    if (selectedIndex === correctIndex) {
        correctAnswersCount++;
        score += points + Math.floor(timeLeft / 3);
    }
  
    if (scoreDisplay) scoreDisplay.textContent = score;
  
    setTimeout(() => {
        currentIndex++;
        nextQuestion();
    }, 1200);
  }
  
  // --- KONIEC QUIZU ---
  function endQuiz() {
    clearInterval(timer);
    showScreen(resultScreen);
    
    let bonusText = `Odpowiedziałeś poprawnie na ${correctAnswersCount} z ${currentQuestions.length} pytań.`;
  
    if (finalScoreText) finalScoreText.textContent = `Twój wynik końcowy: ${score}`;
    if (bonusInfoText) bonusInfoText.textContent = bonusText;
  }
  
  // --- ZAPIS WYNIKU DO SUPABASE ---
  if (saveScoreBtn) {
    saveScoreBtn.addEventListener('click', async () => {
        const nickname = (playerNickname ? playerNickname.value.trim() : '') || 'Kibic';
        saveScoreBtn.disabled = true;
        saveScoreBtn.textContent = 'Zapisywanie...';
  
        try {
            const { error } = await supabaseClient
                .from(CONFIG.SUPABASE_SCORES_TABLE)
                .insert([
                    {
                        nickname: nickname,
                        score: score,
                        difficulty: selectedDifficulty,
                        device_id: deviceId
                    }
                ]);
  
            if (error) throw error;
            
            loadLeaderboard('all');
            showScreen(leaderboardScreen);
        } catch (err) {
            console.error('Błąd zapisu wyniku:', err);
            alert('Nie udało się zapisać wyniku.');
        } finally {
            saveScoreBtn.disabled = false;
            saveScoreBtn.textContent = 'Zapisz wynik 💾';
        }
    });
  }
  
  // --- RANKING I FILTRY ---
  if (leaderboardBtn) {
    leaderboardBtn.addEventListener('click', () => {
        loadLeaderboard('all');
        showScreen(leaderboardScreen);
    });
  }
  
  if (backToStartBtn) {
    backToStartBtn.addEventListener('click', () => {
        showScreen(startScreen);
    });
  }
  
  if (restartBtn) {
    restartBtn.addEventListener('click', () => {
        showScreen(startScreen);
    });
  }
  
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.getAttribute('data-filter');
        loadLeaderboard(filter);
    });
  });
  
  async function loadLeaderboard(filter = 'all') {
    if (!leaderboardList) return;
    leaderboardList.innerHTML = '<p class="loading-text">Ładowanie wyników...</p>';
  
    try {
        let query = supabaseClient
            .from(CONFIG.SUPABASE_SCORES_TABLE)
            .select('*')
            .order('score', { ascending: false })
            .limit(10);
  
        const { data, error } = await query;
        if (error) throw error;
  
        let filteredData = data;
        if (filter && filter !== 'all') {
            filteredData = data.filter(entry => entry.difficulty && entry.difficulty.toLowerCase().trim() === filter.toLowerCase().trim());
        }
  
        leaderboardList.innerHTML = '';
        if (!filteredData || filteredData.length === 0) {
            leaderboardList.innerHTML = '<p class="loading-text">Brak wyników dla tego filtra.</p>';
            return;
        }
  
        filteredData.forEach((entry, index) => {
            const item = document.createElement('div');
            item.classList.add('leaderboard-item');
            
            let diffVal = entry.difficulty ? entry.difficulty.toLowerCase().trim() : 'mix';
            let diffNamePL = diffVal.toUpperCase();
            if (diffVal === 'easy') diffNamePL = 'ŁATWY';
            if (diffVal === 'medium') diffNamePL = 'ŚREDNI';
            if (diffVal === 'hard') diffNamePL = 'TRUDNY';
            
            item.innerHTML = `
                <span>#${index + 1} <strong>${escapeHtml(entry.nickname)}</strong> <span class="lb-badge ${diffVal}">${diffNamePL}</span></span>
                <span style="text-align: right;"><strong class="lb-pts">${entry.score} pkt</strong></span>
            `;
            leaderboardList.appendChild(item);
        });
    } catch (err) {
        console.error('Błąd ładowania rankingu:', err);
        leaderboardList.innerHTML = '<p class="loading-text">Nie udało się załadować rankingu.</p>';
    }
  }
  
  function escapeHtml(text) {
    if (!text) return '';
    return text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }