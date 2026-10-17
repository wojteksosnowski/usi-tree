---
name: execution-focus
description: MANDATORY for all tasks to prevent analysis paralysis, endless re-reading of files, and overthinking. Enforces immediate transition from inspection to direct code editing and verification.
---

# Dyscyplina Wykonawcza (Execution Focus)

Złota zasada przewodnia:
> **"Zadanie jest proste, rób! Nie pierdol!"**

Niniejszy skill definiuje bezwzględną dyscyplinę pracy agenta i blokuje paraliż analityczny (overthinking / analysis paralysis).

---

## 1. Żelazne Reguły Anty-Pętlowe

1. **Zasada 1-Odczytu (Single-Inspection Rule)**:
   - Jeśli cel modyfikacji lub lokalizacja błędu są znane z prompta lub 1 wyszukiwania — **ZAKAZ DALSZEGO CZYTANIA PLIKÓW**.
   - Następnym krokiem **MUSI** być edycja pliku (`replace_file_content` lub `write_to_file`).

2. **Ścisły Zakaz Ponownego Czytania (No Re-reading Loop)**:
   - Nigdy nie wywołuj `view_file` na tym samym pliku lub jego fragmentach więcej niż 1 raz bez wprowadzenia modyfikacji. Informacja jest już w Twoim oknie kontekstu.
   - Zakaz używania narzędzi typu `grep` / `find` / `view_file` jako bezpiecznej prokrastynacji przed zmianą kodu.

3. **Zakaz Parafrazowania Oczywistości (No Self-Echoing)**:
   - Jeśli wiesz, co zrobić, nie powtarzaj w myślach ani w odpowiedzi wniosków z prompta ("Użytkownik chce X, a więc musimy zrobić X...").
   - Natychmiast emituj narzędzie modyfikujące kod.

4. **Budżet Rekonesansu**:
   - Dla prostych zadań i poprawek: **maksymalnie 1 narzędzie read-only**.
   - Dla zadań złożonych: zbierz fakty raz, a następnie bez wahania przystąp do implementacji.

---

## 2. Kanoniczna Sekwencja Egzekucji

```
[Prompt Użytkownika]
       ↓
[Max 1 celowany odczyt pliku (jeśli niezbędny)]
       ↓
[BEZPOŚREDNIA EDYCJA: replace_file_content / write_to_file]
       ↓
[WERYFIKACJA: npm run typecheck / npm test]
       ↓
[Zwięzłe zgłoszenie gotowości użytkownikowi]
```

---

## 3. Wyzwalacz Ratunkowy (Panic Trigger)

Jeśli złapiesz się na tym, że:
- po raz drugi analizujesz ten sam problem,
- chcesz przeczytać plik, który już przeglądałeś,
- generujesz długie wywody w sekcji `thinking` bez wywołania narzędzia edycji,

**NATYCHMIAST PRZERWIJ ROZMYŚLANIA, WYBIERZ NAJPROSTSZE ROZWIĄZANIE I ZASTOSUJ EDYCJĘ KODU.**
