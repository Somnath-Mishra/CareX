import dotenv from 'dotenv';
dotenv.config()
import express from 'express';
import path, { win32 } from 'path';
import bodyParser from 'body-parser';
import { listEvents, authorize } from './calender/listEvent.mjs'
import { ProblemMap, findDoctors } from "./SearchDatabase/problemMapWithSpecilization.mjs"
import { connectMongoDB } from "./connect.mjs"
import mongoose from 'mongoose';
import { addEventDetails, authUrl, oAuth2Client } from "./calender/addEvent.mjs"
import { OAuth2Client } from 'google-auth-library';
import { findSpecifications } from './GenAI/patientProblemWithSpeciliazation.mjs'
import { Doctor } from './models/doctor.mjs';
import Stripe from 'stripe'
//import { validateWebhookSignature, validatePaymentVerification } from 'razorpay'
import Razorpay from 'razorpay'
const app = express();
const authApp = express();


const PORT = 9000;

app.set('view engine', 'ejs');
app.set('views', path.resolve("./views"));
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const stripeSecretKey = process.env.STRIPE_SECRET_API_KEY;
const stripePublicKey = process.env.STRIPE_PUBLIC_API_KEY;
const stripe = new Stripe(stripeSecretKey);

const rajorPaySecret = process.env.RAZORPAY_KEY_SECRET
const rajorPayKeyId = process.env.RAZORPAY_KEY_ID


let rajorPayInstance = new Razorpay({
  key_id: rajorPayKeyId,
  key_secret: rajorPaySecret
})

let orderId;

let doctorsDetails;
const medicalSpecializations = [
  { name: "Anesthesiology" },
  { name: "Cardiology" },
  { name: "Dermatology" },
  { name: "Emergency Medicine" },
  { name: "Endocrinology" },
  { name: "Family Medicine" },
  { name: "Gastroenterology" },
  { name: "General Surgery" },
  { name: "Hematology" },
  { name: "Infectious Disease" },
  { name: "Internal Medicine" },
  { name: "Nephrology" },
  { name: "Neurology" },
  { name: "Obstetrics and Gynecology (OB/GYN)" },
  { name: "Oncology" },
  { name: "Ophthalmology" },
  { name: "Orthopedic Surgery" },
  { name: "Otolaryngology (ENT)" },
  { name: "Pediatrics" },
  { name: "Physical Medicine and Rehabilitation" },
  { name: "Plastic Surgery" },
  { name: "Psychiatry" },
  { name: "Pulmonology" },
  { name: "Radiology" },
  { name: "Rheumatology" },
  { name: "Urology" }
];
connectMongoDB().catch(err => console.log(err));


mongoose.connection.on('disconnected', () => {
  console.log("MongoDB is disconnected");
  process.exit(0);
})


app.get('/', async (req, res) => {
  let mode = 'online';
  const client = await authorize();
  const events = await listEvents(client);
  console.log(events);
  res.render("index.ejs", { events: events, mode: mode });
})

app.get('/google', (req, res) => {
  res.redirect(authUrl);
})

authApp.get('/', async (req, res) => {
  const code = req.query.code;
  const { token } = oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(token);


  oAuth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      process.env.REFRESH_TOKEN = tokens.refresh_token;
    }

  })
  res.send("It's working");
})

app.get('/problem', (req, res) => {
  res.render("problem.ejs");
})

app.get('/blog', (req, res) => {
  res.render("blog.ejs");
})

app.get('/history', (req, res) => {
  res.render("history.ejs");
})

app.post('/problem', async (req, res) => {
  try {
    let specifications = medicalSpecializations.map(specification => specification.name).join(" ");
    const requiredSpecifications = await findSpecifications(req.body.searchResult, specifications);
    const doctors = await findDoctors(requiredSpecifications);
    console.log(doctors);
    doctorsDetails = doctors;
    res.redirect('/doctorSuggestion');
  } catch (error) {
    console.error("Error:", error);
    res.status(500).send("Internal Server Error");
  }
})

app.get('/doctorSuggestion', (req, res) => {
  //res.send(doctorsDetails);
  res.render('doctorSuggestion.ejs', { stripePublicKey: stripePublicKey, doctorsDetails: doctorsDetails });

})


app.get('/bookAppointment', (req, res) => {
  res.render('bookAppointment');
})

app.post('/bookAppointment', async (req, res) => {

  let summary = req.body.summary;
  let description = req.body.description;
  let startDate = req.body.startDate;
  let startTime = req.body.startTime;
  addEventDetails(summary, description, startDate, startTime, oAuth2Client).then(() => {
    console.log("successfully event added")
  })
  res.redirect('/');
})


app.post('/confirmBook', async (req, res) => {
  const doctorId = req.body.doctorId;

  try {
    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({ message: 'Doctor not found' });
    }

    console.log(doctor);
    const fees = doctor.fees;

    stripe.charges.create({
      amount: fees * 100,
      source: req.body.stripeTokenId,
      currency: 'usd'
    }).then(function() {
      console.log('Charge Successful');
      res.json({ message: 'Successfully Booked' })
    }).catch(function() {
      console.log('Charge Fail');
      res.status(500).json({ message: 'Failed to process payment' });
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});



app.post('/payment', async (req, res) => {
  let { amount } = req.body;
  /*
  let rajorPayInstance = new Razorpay({
    key_id: process.env.rajorPayKeyId,
    key_secret: process.env.rajorPaySecret
  })
    */
  let order = await rajorPayInstance.orders.create({
    amount: amount * 100,
    currency: "INR",
    receipt: "receipt#1"
  })
  orderId = order.id;
  res.status(201).json({
    success: true,
    order,
    amount
  })
})

app.post('/', (req, res) => {
  let { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  const generated_signature = hmac_sha256(orderId + "|" + razorpay_payment_id, rajorPaySecret);
  if (generated_signature == razorpay_signature) {
    console.log("Payment is successful");
  }
})

/*
app.post("api/payment/verify", (req, res) => {

  const generated_signature = hmac_sha256(req.body.razorpay_order_id + "|" + req.body.razorpay_payment_id, rajorPaySecret);

  if (generated_signature == req.body.razorpay_signature) {
    console.log("Payment successfully");
  }
})
*/
// app.get('/:room', (req, res) => {
//   res.render('room', { roomId: req.params.room });
// });
app.get('/test', async (req, res) => {

  /*
    // Define the medical specializations
    const medicalSpecializations = [
      "Anesthesiology",
      "Cardiology",
      "Dermatology",
      "Emergency Medicine",
      "Endocrinology",
      "Family Medicine",
      "Gastroenterology",
      "General Surgery",
      "Hematology",
      "Infectious Disease",
      "Internal Medicine",
      "Nephrology",
      "Neurology",
      "Obstetrics and Gynecology (OB/GYN)",
      "Oncology",
      "Ophthalmology",
      "Orthopedic Surgery",
      "Otolaryngology (ENT)",
      "Pediatrics",
      "Physical Medicine and Rehabilitation",
      "Plastic Surgery",
      "Psychiatry",
      "Pulmonology",
      "Radiology",
      "Rheumatology",
      "Urology"
    ];
  
    // Function to generate a random specialization from the given list
    function getRandomSpecialization() {
      return medicalSpecializations[Math.floor(Math.random() * medicalSpecializations.length)];
    }
  
    // Generate 40 dummy doctor objects
    const dummyDoctors = [];
    for (let i = 1; i <= 40; i++) {
      const dummyDoctor = {
        name: `Doctor ${i}`,
        education: `Medical School Name ${i}`,
        specialization: [getRandomSpecialization()]
      };
      dummyDoctors.push(dummyDoctor);
    }
  
    // Now you can use dummyDoctors array as per your requirement, for example, save them to MongoDB
    // Assuming Doctor model is defined using doctorSchema
    dummyDoctors.forEach(async (doctorData) => {
      const doctor = new Doctor(doctorData);
      try {
        await doctor.save();
        console.log(`Doctor ${doctor.name} saved successfully.`);
      } catch (error) {
        console.error(`Error saving Doctor ${doctor.name}:`, error);
      }
    });
    */
  // Function to generate a random fee between $50 and $100
  function getRandomFees() {
    return Math.floor(Math.random() * (100 - 50 + 1)) + 50;
  }
  // Retrieve all documents from the collection
  const doctors = await Doctor.find();

  // Update each document to add the fees field with a random value
  for (const doctor of doctors) {
    // Check if the fees field already exists to prevent overriding existing fees
    if (!doctor.fees) {
      doctor.fees = getRandomFees();
      await doctor.save();
      console.log(`Fees added to Doctor ${doctor.name}: $${doctor.fees}`);
    } else {
      console.log(`Fees already exist for Doctor ${doctor.name}`);
    }
  }

  console.log('All doctors updated successfully.');
  res.send({
    msg: "Successfully added doctor fees details"
  })
})


app.listen(PORT, () => {
  console.log(`Server is started at PORT ${PORT}`);
})
authApp.listen(3003, () => {
  console.log('Auth Server is running at PORT 3003');
})
