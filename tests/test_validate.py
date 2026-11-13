"""E-mails and phone numbers that cannot be right are refused (same rules as web/src/lib/validate.ts)."""
import unittest

from fastapi import HTTPException

from paybybot3 import web


class Emails(unittest.TestCase):
    def test_typos_of_common_providers(self):
        for typed, meant in [("david@gmail.comm", "gmail.com"), ("a@gmial.com", "gmail.com"), ("a@gmail.fr", "gmail.com"),
                             ("a@hotmial.fr", "hotmail.fr"), ("a@hotmail.comm", "hotmail.com"),
                             ("a@orange.fe", "orange.fr"), ("a@outlok.fr", "outlook.fr"), ("a@laposte.fr", "laposte.net")]:
            self.assertIn(meant + " ?", web.email_problem(typed), typed)

    def test_right_ones(self):
        for ok in ["a@gmail.com", "a@hotmail.fr", "a@hotmail.be", "a@yahoo.co.uk", "a@orange.fr", "a@studiopresto.fr",
                   "a@email.com", "a@fre.fr", "prenom.nom+pbb@icloud.com"]:
            self.assertIsNone(web.email_problem(ok), ok)

    def test_bad_format(self):
        for bad in ["pas-un-mail", "a@b", "a b@gmail.com", "a@gmail"]:
            self.assertIn("vérifiez-la", web.email_problem(bad))

    def test_check_refuses_with_400_and_leaves_empty_alone(self):
        web.check_email("")
        with self.assertRaises(HTTPException) as e:
            web.check_email("a@gmail.comm")
        self.assertEqual(e.exception.status_code, 400)


class Phones(unittest.TestCase):
    def test_french_numbers_in_any_usual_way(self):
        for typed in ["777920788", "0777920788", "07 77 92 07 88", "+33777920788", "+33 7 77 92 07 88",
                      "0033777920788", "07.77.92.07.88"]:
            self.assertEqual(web.french_phone(typed), "+33777920788", typed)

    def test_not_french_numbers(self):
        for typed in ["77792078", "07779207888", "+447700900123", "0077920788", "12345", ""]:
            self.assertIsNone(web.french_phone(typed), typed)

    def test_signup_refuses_a_bad_number_or_e_mail(self):
        for username, email in [("0612", "a@gmail.com"), ("0612345678", "a@gmail.comm")]:
            with self.assertRaises(HTTPException) as e:
                web.login(web.Login(username=username, password="x", signup=True, accepted=True, email=email), None, None)
            self.assertEqual(e.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
