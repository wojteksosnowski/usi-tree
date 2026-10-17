import { describe, it, expect } from 'vitest';
import { hasSpeciesInfo, leafToneShift, resolveTreeKind, treeKindParams } from '../core/treeSpeciesRegistry.js';
import { SPECIES_PROFILES } from '../core/TreeGenerator.js';

describe('rejestr rodzajów drzew 3D', () => {
  it('rodzaj łaciński i nazwa polska prowadzą do gatunku generatora albo dopasowanego profilu', () => {
    expect(resolveTreeKind({ genus: 'Quercus' })).toBe('OAK');
    expect(resolveTreeKind({ nameLatin: 'Tilia cordata' })).toBe('Linden');
    expect(resolveTreeKind({ namePolish: 'klon zwyczajny' })).toBe('Sycamore');
    expect(resolveTreeKind({ genus: 'Salix', nameLatin: 'Salix babylonica' })).toBe('Weeping Willow');
    expect(resolveTreeKind({ genus: 'Salix' })).toBe('WILLOW');
    expect(resolveTreeKind({ nameLatin: 'Populus tremula' })).toBe('Quaking Aspen');
    expect(resolveTreeKind({ genus: 'Picea' })).toBe('SPRUCE');
  });

  it('gatunki samplera Standardu Zieleni i braki danych', () => {
    expect(resolveTreeKind({ species: 'MAPLE' })).toBe('Sycamore');
    expect(resolveTreeKind({ species: 'PINE' })).toBe('PINE');
    expect(resolveTreeKind({ leafType: 'needleleaved' })).toBe('SPRUCE');
    expect(resolveTreeKind({})).toBe('Linden');
  });

  it('profil dopasowany ma pierwszeństwo przed gatunkiem bazowym', () => {
    const linden = treeKindParams('Linden');
    expect(linden.profile).toBeDefined();
    expect(linden.species in SPECIES_PROFILES).toBe(true);
    expect(treeKindParams('Viburnum').form).toBe('MULTI');
    expect(treeKindParams('OAK')).toEqual({ species: 'OAK', form: 'SINGLE' });
  });
});

describe('tony listowia rodzajów', () => {
  it('przesuwa gatunki zgodnie z cechami: lipa cieplej, świerk chłodniej, dąb ciemniej, osika bledziej', () => {
    expect(leafToneShift('Linden').hue).toBeLessThan(0);
    expect(leafToneShift('SPRUCE').hue).toBeGreaterThan(0);
    expect(leafToneShift('OAK').lightness).toBeLessThan(1);
    expect(leafToneShift('Quaking Aspen').saturation).toBeLessThan(1);
    expect(leafToneShift('BUSH')).toEqual({ hue: 0, saturation: 1, lightness: 1 });
    expect(leafToneShift(null)).toEqual({ hue: 0, saturation: 1, lightness: 1 });
    // klon i lipa (najczęstsze w mieście) wyraźnie różne
    expect(Math.abs(leafToneShift('Linden').lightness - leafToneShift('Sycamore').lightness)).toBeGreaterThan(0.15);
  });

  it('gatunek nieznany, gdy drzewo nie ma rodzaju ani nazwy', () => {
    expect(hasSpeciesInfo({ leafType: 'broadleaved', nameLatin: '', namePolish: '' })).toBe(false);
    expect(hasSpeciesInfo({ genus: 'Acer' })).toBe(true);
    expect(resolveTreeKind({ genus: 'Platanus' })).toBe('Plane');
  });
});
