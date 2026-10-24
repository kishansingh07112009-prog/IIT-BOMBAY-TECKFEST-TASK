/**
 * EquiSplit - Precise Bill & Expense Splitter
 * Vanilla JavaScript (No frameworks, external libraries, or CDN dependencies)
 * Runs 100% locally in the browser with localStorage persistence.
 */

(function () {
  'use strict';

  // Storage Key
  const STORAGE_KEY = 'equisplit_saved_calculation';

  // DOM Elements
  const billForm = document.getElementById('billForm');
  const occasionInput = document.getElementById('occasionInput');
  const billAmountInput = document.getElementById('billAmountInput');
  const peopleCountInput = document.getElementById('peopleCountInput');
  const currencySelect = document.getElementById('currencySelect');
  const currencyPrefix = document.getElementById('currencyPrefix');

  // Buttons & Steppers
  const decrementPeopleBtn = document.getElementById('decrementPeopleBtn');
  const incrementPeopleBtn = document.getElementById('incrementPeopleBtn');
  const resetBtn = document.getElementById('resetBtn');
  const clearBillBtn = document.getElementById('clearBillBtn');
  const copySummaryBtn = document.getElementById('copySummaryBtn');
  const copyBtnText = document.getElementById('copyBtnText');
  const copyFeedback = document.getElementById('copyFeedback');

  // Feedback & Errors
  const formAlertBanner = document.getElementById('formAlertBanner');
  const formAlertMessage = document.getElementById('formAlertMessage');
  const billAmountError = document.getElementById('billAmountError');
  const peopleCountError = document.getElementById('peopleCountError');

  // Views
  const emptyState = document.getElementById('emptyState');
  const resultsView = document.getElementById('resultsView');

  // Result Output Elements
  const resultsOccasionTitle = document.getElementById('resultsOccasionTitle') || document.querySelector('.results-occasion-title');
  const calcTimestamp = document.getElementById('calcTimestamp');
  const remainderBadge = document.getElementById('remainderBadge');
  const remainderBadgeText = document.getElementById('remainderBadgeText');
  const displayTotalBill = document.getElementById('displayTotalBill');
  const displayPeopleCount = document.getElementById('displayPeopleCount');
  const displayPerPersonShare = document.getElementById('displayPerPersonShare');
  const auditFormulaText = document.getElementById('auditFormulaText');
  const remainderExplanation = document.getElementById('remainderExplanation');
  const participantCountTag = document.getElementById('participantCountTag');
  const participantsList = document.getElementById('participantsList');

  // In-Memory Current State
  let currentCalculation = null;

  /* ==========================================================================
     Utility & Minor-Unit Math Functions
     ========================================================================== */

  /**
   * Parse a string amount into integer minor units (e.g. paise / cents)
   * Prevents IEEE-754 floating-point rounding errors.
   */
  function parseAmountToMinorUnits(inputStr) {
    if (typeof inputStr !== 'string') {
      return { valid: false, error: 'Invalid input format.' };
    }
    const trimmed = inputStr.trim();
    if (!trimmed) {
      return { valid: false, error: 'Total bill amount is required.' };
    }

    // Strip leading currency symbols if user pasted them
    const cleanStr = trimmed.replace(/^[₹$€£¥\s]+/, '').trim();
    if (!cleanStr) {
      return { valid: false, error: 'Please enter a valid bill amount.' };
    }

    // Reject negative numbers
    if (cleanStr.startsWith('-')) {
      return { valid: false, error: 'Bill amount cannot be negative.' };
    }

    // Reject non-numeric input (allow up to 2 decimal places)
    if (!/^\d+(\.\d{1,2})?$/.test(cleanStr)) {
      if (cleanStr.includes('.') && cleanStr.split('.')[1].length > 2) {
        return { valid: false, error: 'Bill amount cannot have more than 2 decimal places.' };
      }
      return { valid: false, error: 'Bill amount must be a valid positive number.' };
    }

    const parts = cleanStr.split('.');
    const major = parseInt(parts[0], 10);
    const minorStr = parts[1] ? (parts[1] + '00').slice(0, 2) : '00';
    const minor = parseInt(minorStr, 10);

    const totalMinor = major * 100 + minor;

    if (isNaN(totalMinor)) {
      return { valid: false, error: 'Calculation resulted in an invalid number.' };
    }

    if (totalMinor <= 0) {
      return { valid: false, error: 'Bill amount must be greater than zero.' };
    }

    if (totalMinor > 100000000000) { // Limit to 1 billion
      return { valid: false, error: 'Bill amount exceeds maximum supported limit.' };
    }

    return { valid: true, totalMinor, cleanStr };
  }

  /**
   * Parse number of people into a positive integer.
   */
  function parsePeopleCount(inputStr) {
    if (typeof inputStr !== 'string') {
      return { valid: false, error: 'Invalid input format.' };
    }
    const trimmed = inputStr.trim();
    if (!trimmed) {
      return { valid: false, error: 'Number of people is required.' };
    }

    if (trimmed.startsWith('-')) {
      return { valid: false, error: 'Number of people cannot be negative.' };
    }

    if (trimmed.includes('.')) {
      return { valid: false, error: 'Number of people must be a whole integer.' };
    }

    if (!/^\d+$/.test(trimmed)) {
      return { valid: false, error: 'Number of people must be a valid whole number.' };
    }

    const count = parseInt(trimmed, 10);
    if (isNaN(count) || count < 1) {
      return { valid: false, error: 'At least 1 person is required to split the bill.' };
    }

    if (count > 500) {
      return { valid: false, error: 'Number of people cannot exceed 500.' };
    }

    return { valid: true, count };
  }

  /**
   * Formats integer minor units back into currency string
   * e.g. 10050 minor units -> "₹100.50"
   */
  function formatMinorUnits(minorUnits, symbol = '₹') {
    const isNeg = minorUnits < 0;
    const absUnits = Math.abs(minorUnits);
    const major = Math.floor(absUnits / 100);
    const minor = absUnits % 100;
    const minorFormatted = minor < 10 ? '0' + minor : '' + minor;

    let majorFormatted = major.toLocaleString('en-IN');
    if (symbol !== '₹') {
      majorFormatted = major.toLocaleString('en-US');
    }

    return `${isNeg ? '-' : ''}${symbol}${majorFormatted}.${minorFormatted}`;
  }

  /**
   * Core split calculation with zero rounding-error remainder distribution
   */
  function calculateSplit(totalMinor, peopleCount, occasionName, symbol, existingParticipants = null) {
    const defaultOccasion = 'Friends Get-Together';
    const cleanOccasion = (occasionName && occasionName.trim()) ? occasionName.trim() : defaultOccasion;

    // Integer division and remainder
    const baseMinor = Math.floor(totalMinor / peopleCount);
    const remainder = totalMinor % peopleCount;

    const participants = [];
    let sumCheckMinor = 0;

    for (let i = 0; i < peopleCount; i++) {
      const hasRemainderUnit = i < remainder;
      const shareMinor = baseMinor + (hasRemainderUnit ? 1 : 0);
      sumCheckMinor += shareMinor;

      // Retain custom name and paid status if restoring or re-evaluating
      let customName = '';
      let isPaid = false;
      if (existingParticipants && existingParticipants[i]) {
        customName = existingParticipants[i].customName || '';
        isPaid = Boolean(existingParticipants[i].isPaid);
      }

      participants.push({
        id: i + 1,
        defaultName: `Person ${i + 1}`,
        customName: customName,
        shareMinor: shareMinor,
        hasRemainderUnit: hasRemainderUnit,
        isPaid: isPaid
      });
    }

    const exactMatch = (sumCheckMinor === totalMinor);

    return {
      occasion: cleanOccasion,
      totalMinor: totalMinor,
      peopleCount: peopleCount,
      currencySymbol: symbol,
      baseMinor: baseMinor,
      remainder: remainder,
      participants: participants,
      calculatedSumMinor: sumCheckMinor,
      exactMatch: exactMatch,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  }

  /* ==========================================================================
     UI Error Handling & View Transitions
     ========================================================================== */

  function clearErrors() {
    formAlertBanner.classList.add('hidden');
    formAlertMessage.textContent = '';
    
    billAmountInput.classList.remove('input-error');
    billAmountError.classList.add('hidden');
    billAmountError.textContent = '';

    peopleCountInput.classList.remove('input-error');
    peopleCountError.classList.add('hidden');
    peopleCountError.textContent = '';
  }

  function showError(field, message) {
    if (field === 'billAmount') {
      billAmountInput.classList.add('input-error');
      billAmountError.textContent = message;
      billAmountError.classList.remove('hidden');
    } else if (field === 'peopleCount') {
      peopleCountInput.classList.add('input-error');
      peopleCountError.textContent = message;
      peopleCountError.classList.remove('hidden');
    }

    formAlertMessage.textContent = message;
    formAlertBanner.classList.remove('hidden');
  }

  /**
   * Clears or hides outdated results when user submits invalid values
   */
  function hideOutdatedResults() {
    currentCalculation = null;
    resultsView.classList.add('hidden');
    emptyState.classList.remove('hidden');
  }

  /* ==========================================================================
     Results Rendering
     ========================================================================== */

  function renderResults(calc) {
    const sym = calc.currencySymbol;
    const unitName = sym === '₹' ? 'paise' : (sym === '£' ? 'pence' : 'cent');
    const unitNamePlural = sym === '₹' ? 'paise' : (sym === '£' ? 'pence' : 'cents');

    // Occasion & Timestamp
    if (resultsOccasionTitle) {
      resultsOccasionTitle.textContent = calc.occasion;
    }
    calcTimestamp.textContent = `Calculated today at ${calc.timestamp}`;

    // Metrics Box
    displayTotalBill.textContent = formatMinorUnits(calc.totalMinor, sym);
    displayPeopleCount.textContent = `${calc.peopleCount} ${calc.peopleCount === 1 ? 'person' : 'people'}`;

    if (calc.remainder === 0) {
      displayPerPersonShare.textContent = formatMinorUnits(calc.baseMinor, sym);
      remainderBadge.className = 'results-badge';
      remainderBadgeText.textContent = 'Exact Even Split';
    } else {
      displayPerPersonShare.textContent = `${formatMinorUnits(calc.baseMinor, sym)} – ${formatMinorUnits(calc.baseMinor + 1, sym)}`;
      remainderBadge.className = 'results-badge has-remainder';
      remainderBadgeText.textContent = `${calc.remainder} ${calc.remainder === 1 ? 'person pays' : 'people pay'} +1 ${unitName}`;
    }

    // Mathematical Audit
    if (calc.remainder === 0) {
      auditFormulaText.textContent = `${calc.peopleCount} × ${formatMinorUnits(calc.baseMinor, sym)} = ${formatMinorUnits(calc.totalMinor, sym)}`;
      remainderExplanation.textContent = `The bill divides with zero remainder. Every person contributes an identical share of ${formatMinorUnits(calc.baseMinor, sym)}.`;
    } else {
      const extraPeople = calc.remainder;
      const basePeople = calc.peopleCount - calc.remainder;
      
      let formulaStr = '';
      if (basePeople > 0) {
        formulaStr = `(${extraPeople} × ${formatMinorUnits(calc.baseMinor + 1, sym)}) + (${basePeople} × ${formatMinorUnits(calc.baseMinor, sym)}) = ${formatMinorUnits(calc.totalMinor, sym)}`;
      } else {
        formulaStr = `${extraPeople} × ${formatMinorUnits(calc.baseMinor + 1, sym)} = ${formatMinorUnits(calc.totalMinor, sym)}`;
      }

      auditFormulaText.textContent = `${formulaStr} (Exact 100% Match)`;
      remainderExplanation.textContent = `When dividing into two decimal places, a remainder of ${calc.remainder} ${calc.remainder === 1 ? unitName : unitNamePlural} remained. To ensure the total matches ${formatMinorUnits(calc.totalMinor, sym)} down to the last penny, ${extraPeople} ${extraPeople === 1 ? 'person contributes' : 'people contribute'} +1 ${unitName} (${formatMinorUnits(calc.baseMinor + 1, sym)}) and ${basePeople} ${basePeople === 1 ? 'person contributes' : 'people contribute'} ${formatMinorUnits(calc.baseMinor, sym)}.`;
    }

    participantCountTag.textContent = `${calc.peopleCount} ${calc.peopleCount === 1 ? 'Participant' : 'Participants'}`;

    // Render Participant List
    participantsList.innerHTML = '';
    calc.participants.forEach((p, index) => {
      const item = document.createElement('div');
      item.className = `participant-item ${p.isPaid ? 'is-paid' : ''}`;
      item.setAttribute('role', 'listitem');
      item.dataset.index = index;

      const left = document.createElement('div');
      left.className = 'participant-left';

      const avatar = document.createElement('div');
      avatar.className = 'participant-avatar';
      avatar.textContent = (p.customName || p.defaultName).charAt(0).toUpperCase();

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'participant-name-input';
      nameInput.value = p.customName || p.defaultName;
      nameInput.placeholder = p.defaultName;
      nameInput.title = 'Click to rename participant';
      nameInput.maxLength = 30;

      nameInput.addEventListener('input', (e) => {
        p.customName = e.target.value.trim();
        avatar.textContent = (p.customName || p.defaultName).charAt(0).toUpperCase();
        saveCalculationToStorage();
      });

      left.appendChild(avatar);
      left.appendChild(nameInput);

      const right = document.createElement('div');
      right.className = 'participant-right';

      const amountCol = document.createElement('div');
      amountCol.className = 'participant-amount-col';

      const amount = document.createElement('span');
      amount.className = 'participant-amount font-tabular';
      amount.textContent = formatMinorUnits(p.shareMinor, sym);
      amountCol.appendChild(amount);

      if (p.hasRemainderUnit) {
        const note = document.createElement('span');
        note.className = 'remainder-note';
        note.textContent = `+1 ${unitName}`;
        amountCol.appendChild(note);
      }

      const paidLabel = document.createElement('label');
      paidLabel.className = 'paid-toggle';
      paidLabel.title = 'Toggle paid status';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'paid-checkbox';
      checkbox.checked = Boolean(p.isPaid);
      checkbox.setAttribute('aria-label', `Mark ${p.customName || p.defaultName} as paid`);

      checkbox.addEventListener('change', () => {
        p.isPaid = checkbox.checked;
        if (p.isPaid) {
          item.classList.add('is-paid');
        } else {
          item.classList.remove('is-paid');
        }
        saveCalculationToStorage();
      });

      paidLabel.appendChild(checkbox);

      right.appendChild(amountCol);
      right.appendChild(paidLabel);

      item.appendChild(left);
      item.appendChild(right);
      participantsList.appendChild(item);
    });

    // Reveal results view
    emptyState.classList.add('hidden');
    resultsView.classList.remove('hidden');
  }

  /* ==========================================================================
     Storage & Persistence (LocalStorage)
     ========================================================================== */

  function saveCalculationToStorage() {
    if (!currentCalculation) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(currentCalculation));
    } catch (e) {
      console.warn('Unable to persist to localStorage', e);
    }
  }

  function loadCalculationFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;

      const saved = JSON.parse(raw);
      if (!saved || typeof saved.totalMinor !== 'number' || typeof saved.peopleCount !== 'number') {
        return false;
      }

      // Re-verify exact calculation
      const restored = calculateSplit(
        saved.totalMinor,
        saved.peopleCount,
        saved.occasion,
        saved.currencySymbol || '₹',
        saved.participants
      );

      if (!restored.exactMatch) {
        return false;
      }

      // Populate Inputs
      occasionInput.value = (saved.occasion === 'Friends Get-Together') ? '' : saved.occasion;
      
      const major = Math.floor(saved.totalMinor / 100);
      const minor = saved.totalMinor % 100;
      billAmountInput.value = `${major}.${minor < 10 ? '0' + minor : minor}`;
      peopleCountInput.value = saved.peopleCount.toString();

      if (saved.currencySymbol && currencySelect) {
        currencySelect.value = saved.currencySymbol;
        currencyPrefix.textContent = saved.currencySymbol;
      }

      currentCalculation = restored;
      renderResults(restored);
      return true;
    } catch (e) {
      console.warn('Error reading saved calculation', e);
      return false;
    }
  }

  function clearStorage() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      console.warn('Error clearing storage', e);
    }
  }

  /* ==========================================================================
     Event Handlers
     ========================================================================== */

  // Form Submission
  billForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();

    const amountResult = parseAmountToMinorUnits(billAmountInput.value);
    const peopleResult = parsePeopleCount(peopleCountInput.value);

    // Validation Check: both must be valid
    if (!amountResult.valid || !peopleResult.valid) {
      // Clear or hide outdated results
      hideOutdatedResults();

      if (!amountResult.valid) {
        showError('billAmount', amountResult.error);
      }
      if (!peopleResult.valid) {
        showError('peopleCount', peopleResult.error);
      }
      return;
    }

    const sym = currencySelect.value;
    const occasion = occasionInput.value;

    // Perform accurate calculation
    const calc = calculateSplit(
      amountResult.totalMinor,
      peopleResult.count,
      occasion,
      sym
    );

    currentCalculation = calc;
    saveCalculationToStorage();
    renderResults(calc);
  });

  // Currency Selection Change
  currencySelect.addEventListener('change', function () {
    const sym = currencySelect.value;
    currencyPrefix.textContent = sym;

    if (currentCalculation) {
      currentCalculation.currencySymbol = sym;
      saveCalculationToStorage();
      renderResults(currentCalculation);
    }
  });

  // People Count Stepper Buttons
  decrementPeopleBtn.addEventListener('click', function () {
    const current = parseInt(peopleCountInput.value, 10);
    const nextVal = (isNaN(current) || current <= 1) ? 1 : current - 1;
    peopleCountInput.value = nextVal;
  });

  incrementPeopleBtn.addEventListener('click', function () {
    const current = parseInt(peopleCountInput.value, 10);
    const nextVal = isNaN(current) ? 2 : current + 1;
    peopleCountInput.value = Math.min(nextVal, 500);
  });

  // Group Preset Buttons
  document.querySelectorAll('.group-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const count = btn.dataset.people;
      if (count) {
        peopleCountInput.value = count;
      }
    });
  });

  // Quick Bill Add Presets
  document.querySelectorAll('.preset-btn[data-add]').forEach(btn => {
    btn.addEventListener('click', () => {
      const toAdd = parseInt(btn.dataset.add, 10);
      const currentVal = parseFloat(billAmountInput.value) || 0;
      const nextVal = (currentVal + toAdd).toFixed(2);
      billAmountInput.value = nextVal;
    });
  });

  clearBillBtn.addEventListener('click', () => {
    billAmountInput.value = '';
    billAmountInput.focus();
  });

  // Form Reset
  resetBtn.addEventListener('click', function () {
    clearErrors();
    billForm.reset();
    currencySelect.value = '₹';
    currencyPrefix.textContent = '₹';
    peopleCountInput.value = '3';
    hideOutdatedResults();
    clearStorage();
  });

  // Copy Summary to Clipboard
  copySummaryBtn.addEventListener('click', function () {
    if (!currentCalculation) return;

    const calc = currentCalculation;
    const sym = calc.currencySymbol;
    let text = `🧾 Bill Split: ${calc.occasion}\n`;
    text += `💰 Total Bill: ${formatMinorUnits(calc.totalMinor, sym)}\n`;
    text += `👥 Split Between: ${calc.peopleCount} ${calc.peopleCount === 1 ? 'person' : 'people'}\n`;
    text += `────────────────────────────\n`;

    calc.participants.forEach(p => {
      const name = p.customName || p.defaultName;
      const share = formatMinorUnits(p.shareMinor, sym);
      const paidStatus = p.isPaid ? ' [Paid ✓]' : '';
      text += `• ${name}: ${share}${paidStatus}\n`;
    });

    text += `────────────────────────────\n`;
    text += `✓ Sum Total: ${formatMinorUnits(calc.calculatedSumMinor, sym)} (Exact 100% Match)\n`;
    text += `Generated with EquiSplit`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showCopyFeedback();
      }).catch(() => {
        fallbackCopyText(text);
      });
    } else {
      fallbackCopyText(text);
    }
  });

  function fallbackCopyText(text) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-9999px';
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showCopyFeedback();
    } catch (err) {
      console.warn('Fallback copy failed', err);
    }
    document.body.removeChild(textArea);
  }

  function showCopyFeedback() {
    copyFeedback.classList.remove('hidden');
    copyBtnText.textContent = 'Copied to Clipboard!';
    setTimeout(() => {
      copyFeedback.classList.add('hidden');
      copyBtnText.textContent = 'Copy Shareable Summary';
    }, 2800);
  }

  // Clear error states on input change
  billAmountInput.addEventListener('input', function () {
    billAmountInput.classList.remove('input-error');
    billAmountError.classList.add('hidden');
    formAlertBanner.classList.add('hidden');
  });

  peopleCountInput.addEventListener('input', function () {
    peopleCountInput.classList.remove('input-error');
    peopleCountError.classList.add('hidden');
    formAlertBanner.classList.add('hidden');
  });

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', function () {
    loadCalculationFromStorage();
  });

})();
