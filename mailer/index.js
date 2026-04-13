const nodemailer = require('nodemailer');

// Configure via environment variables
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  },
});

async function sendBookingConfirmation(user, alert, booking) {
  if (!process.env.SMTP_USER) {
    console.log('[mailer] SMTP not configured — skipping email notification');
    console.log(`[mailer] Would send to ${user.email}: Booking confirmed for ${alert.hotel_name} at ${booking.price} ILS`);
    return;
  }

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #2563eb;">HotelBid — Reservation Confirmed!</h1>
      <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <h2>${alert.hotel_name}</h2>
        <p><strong>Check-in:</strong> ${alert.check_in}</p>
        <p><strong>Check-out:</strong> ${alert.check_out}</p>
        <p><strong>Guests:</strong> ${alert.adults} adults, ${alert.children} children</p>
        <p><strong>Price:</strong> ${booking.price} ILS</p>
        <p><strong>Source:</strong> ${booking.source}</p>
        <p><strong>Your target was:</strong> ${alert.target_price} ILS</p>
        <p><strong>You saved:</strong> ${alert.target_price - booking.price} ILS</p>
      </div>
      <a href="${booking.url}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">
        View Reservation
      </a>
      <p style="color: #666; margin-top: 20px; font-size: 12px;">
        This reservation has free cancellation. Review the terms on the booking site.
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"HotelBid" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `Booking Confirmed: ${alert.hotel_name} — ${booking.price} ILS`,
    html,
  });

  console.log(`[mailer] Confirmation sent to ${user.email}`);
}

async function sendPriceAlert(user, alert, price) {
  if (!process.env.SMTP_USER) {
    console.log(`[mailer] Would notify ${user.email}: Price drop for ${alert.hotel_name} — ${price.prix_total} ILS on ${price.source}`);
    return;
  }

  await transporter.sendMail({
    from: `"HotelBid" <${process.env.SMTP_USER}>`,
    to: user.email,
    subject: `Price Alert: ${alert.hotel_name} — ${price.prix_total} ILS`,
    html: `
      <h2>Price found below your target!</h2>
      <p>${alert.hotel_name}: <strong>${price.prix_total} ILS</strong> on ${price.source}</p>
      <p>Your target: ${alert.target_price} ILS</p>
      <a href="${price.lien_reservation}">Book Now</a>
    `,
  });
}

module.exports = { sendBookingConfirmation, sendPriceAlert };
