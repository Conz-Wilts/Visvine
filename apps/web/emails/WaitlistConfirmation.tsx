import { BRAND } from "@/lib/brand";

export function WaitlistConfirmation({ firstName }: { firstName: string }) {
  return (
    <div style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", maxWidth: "600px", margin: "0 auto", backgroundColor: "#ffffff" }}>
      {/* Header Section */}
      <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: BRAND }}>
        <tbody>
          <tr>
            <td style={{ padding: "40px 20px", textAlign: "center" }}>
              <img
                src={process.env.NEXT_PUBLIC_APP_URL ? `${process.env.NEXT_PUBLIC_APP_URL}/email-logo.png` : "/email-logo.png"}
                alt="Visvine"
                width="80"
                height="80"
                style={{ display: "block", margin: "0 auto 20px auto", backgroundColor: BRAND }}
              />
              <h1 style={{ color: "#ffffff", margin: "0 0 10px 0", fontSize: "32px", fontWeight: "700", textAlign: "center" }}>
                You're on the list!
              </h1>
              <p style={{ color: "#ffffff", margin: "0", fontSize: "16px", textAlign: "center" }}>
                Thanks for your interest
              </p>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Body Section */}
      <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: "#ffffff" }}>
        <tbody>
          <tr>
            <td style={{ padding: "40px 20px", textAlign: "center" }}>
              <p style={{ color: "#000000", fontSize: "16px", lineHeight: "1.6", margin: "0 0 20px 0", fontWeight: "500" }}>
                Hi {firstName},
              </p>
              <p style={{ color: "#000000", fontSize: "16px", lineHeight: "1.6", margin: "0 0 20px 0" }}>
                We've got you down on our waitlist for early access. We're building something great and can't wait to share it with you soon.
              </p>
              <p style={{ color: "#000000", fontSize: "16px", lineHeight: "1.6", margin: "0 0 30px 0" }}>
                In the meantime, follow us on LinkedIn or check back for launch updates.
              </p>

              {/* Buttons */}
              <div style={{ margin: "0 0 30px 0" }}>
                <a href="https://www.linkedin.com/company/visvine/" style={{ display: "inline-block", backgroundColor: BRAND, color: "#ffffff", padding: "12px 30px", borderRadius: "6px", textDecoration: "none", fontSize: "14px", fontWeight: "600", marginRight: "10px" }}>
                  Follow on LinkedIn
                </a>
                <a href="https://visvine.com" style={{ display: "inline-block", backgroundColor: "#171717", color: "#ffffff", padding: "12px 30px", borderRadius: "6px", textDecoration: "none", fontSize: "14px", fontWeight: "600" }}>
                  Visit Visvine
                </a>
              </div>

              <p style={{ color: "#000000", fontSize: "14px", lineHeight: "1.6", margin: "0", textAlign: "center" }}>
                See you soon,<br />
                Connor
              </p>
            </td>
          </tr>
        </tbody>
      </table>

      {/* Footer Section */}
      <table width="100%" cellPadding="0" cellSpacing="0" style={{ backgroundColor: BRAND }}>
        <tbody>
          <tr>
            <td style={{ padding: "20px", textAlign: "center", fontSize: "12px", color: "#ffffff" }}>
              © 2026 Visvine. All rights reserved.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
