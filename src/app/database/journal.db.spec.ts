import { TestBed } from '@angular/core/testing';

import { JournalDb } from './journal.db';

describe('JournalDb', () => {
  let service: JournalDb;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(JournalDb);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
