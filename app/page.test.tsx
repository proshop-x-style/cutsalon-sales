import { fireEvent, render, screen } from '@testing-library/react';
import Page from './page';

describe('Salon ledger landing page', () => {
  it('renders the main title and account summary sections', () => {
    render(<Page />);

    expect(
      screen.getByRole('heading', { name: /Cutsalon Thankyou 会計管理アプリ/i }),
    ).toBeInTheDocument();

    expect(screen.getByRole('heading', { name: '今月' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今年' })).toBeInTheDocument();
    expect(screen.getAllByText('売上').length).toBeGreaterThan(0);
    expect(screen.getAllByText('利益率').length).toBeGreaterThan(0);
  });

  it('switches to the sales input page from the top menu', () => {
    render(<Page />);

    fireEvent.click(screen.getByRole('link', { name: '売上入力' }));

    expect(screen.getByRole('heading', { name: '売上入力' })).toBeInTheDocument();
    expect(screen.getByText(/日計表をアップロードするか、人数を入力して売上を保存します。/i)).toBeInTheDocument();
  });
});
