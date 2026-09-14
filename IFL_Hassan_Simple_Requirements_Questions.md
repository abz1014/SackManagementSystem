# IFL / Hassan SB — Simple Requirement Questions

## Purpose

Please send these questions to Hassan in simple language. He does not need to answer the technical PLC/database questions himself. If he does not know, he can forward them to the relevant IFL person.

---

## A. Machines

1. We understand there are 14 Rieter cone winding machines on TP1 Unit 2 Line #3. Is this correct?

2. Does each machine have a unique machine number/name?

3. Does each machine have stations/spindles/heads that need to be identified separately?

4. For sack packing, how many sack-packing machines are there?

5. Does every sack record tell us which machine produced/packed that sack?

---

## B. Cone Weight

6. Which system/database currently contains the cone weight data?

7. Are ALL cone weights saved in the database, or only rejected/selected cones?

8. What is the normal target cone weight?

9. Is the allowed weight range different for different products?

10. Who decides the allowed + and - weight limits?

11. When a cone is rejected, does the database tell us why it was rejected?

12. Can you give us a list explaining every reject code? For example:
   - Code 1 = ?
   - Code 2 = ?
   - Code 3 = ?

---

## C. Product Information

13. What information identifies a product?
   - Blend?
   - Count?
   - Tube type?
   - Material?
   - Lot?

14. When production changes from Product A to Product B, how is this currently recorded?

15. Does the existing system/database automatically know which product is running?

16. If not, should the engineer select the current product from our software?

17. When the product changes, should the software keep the old product against old cones and use the new product for new cones?

18. Should our software be allowed to add/change/retire products in PDAS?

19. If yes, who is authorized to make these changes?

---

## D. Sack Data

20. Which database contains the sack information?

21. What information is saved for every sack?

22. Does each sack have a unique number/ID?

23. Does each sack have:
   - weight?
   - date/time?
   - product?
   - machine number?
   - lot number?
   - pallet number?

24. Is sack weight Gross, Net, or something else?

25. What exactly does the sack timestamp mean?
   - time weighing started?
   - time weighing finished?
   - time record was saved?
   - something else?

26. Can we know exactly which cone(s) went into each sack?

27. If not, is it enough to show sack information separately from cone information?

---

## E. Sack Stock

28. What exactly do you mean by "sack stock for each machine"?

For example, do you want:
- sacks received
- sacks issued to machine
- sacks used
- sacks remaining
- damaged/returned sacks

29. Who will enter sack receipt/issue information?

30. Is sack stock currently maintained in Excel, ERP, manually, or somewhere else?

31. Does every sack type have a separate code?

32. Do different machines use different sack types?

---

## F. Reports

33. What reports do you want every day?

34. What reports do you want every shift?

35. What information should management see on the main dashboard?

36. Do you want reports in Excel/PDF?

37. Do you want the system to automatically email reports?

---

## G. Users

38. Who will use the software?

For example:
- Operator
- Supervisor
- Process Engineer
- Quality Engineer
- Manager
- Admin

39. What should each person be allowed to do?

40. Who should be allowed to change product limits?

41. Who should be allowed to change products?

42. Who should be allowed to see reports?

43. Who should be allowed to make sack-stock adjustments?

---

## H. Live Data / Speed

44. How quickly do you expect the software to show new production data?

For example:
- immediately
- within 1 minute
- within 5 minutes
- within 15 minutes

45. Is a delay of a few minutes acceptable if the existing database itself receives the data with a delay?

---

## I. AI / Calibration

46. When you say "AI should recommend calibration", what exactly do you want?

For example:

"Machine 7 is continuously producing cones 8 grams above target. The software should tell the engineer that calibration/adjustment may be required."

Is this what you mean?

47. Should the software only give a recommendation, or should it automatically change the machine setting?

48. If automatic change is required, who must approve it?

49. Do you have historical records showing when an engineer adjusted/calibrated a machine?

50. Do you have records showing the weight before and after each calibration?

---

## J. Historical Data

51. How much historical cone data can IFL provide?

52. How much historical sack data can IFL provide?

53. Can you provide at least 6 months of data?

54. Can you provide 12 months of data?

55. Is there older data available in backup databases?

56. We especially need the data from 10 July 2026 to 5 August 2026 because there is a historical gap in the sample we have. Can you provide this period?

57. If possible, can you provide 12 months of:
- cone readings
- rejects
- product information
- machine/station ID
- sack records
- calibration/adjustment records?

---

## K. Database / PLC

58. Can IFL provide read-only access to the Cone database?

59. Can IFL provide read-only access to the Sack Packing database?

60. Can IFL provide the PDAS database details/stored procedures?

61. What PLCs are used for the cones?

62. What PLC is used for sack packing?

63. What communication protocol do the PLCs use?

64. Do you want our software to read the PLCs directly, or is reading the existing databases enough?

---

## L. Hardware

65. Does IFL already have a server/industrial PC for this system?

66. Where should the software be installed?

67. Is there already a PC/display near the production floor?

68. Is there a UPS for the server?

69. Is there an existing network connection between the server and the required databases/PLCs?

70. Can IFL provide a Windows PC/server if required, or should QTech include it in the quotation?

---

# MOST IMPORTANT QUESTIONS

If Hassan is busy, ask him these first:

1. Can you confirm the 14-machine Rieter setup?
2. Where exactly are cone and sack data stored?
3. Does every cone record have machine/station ID?
4. Does every sack record have machine ID?
5. Can you provide 6–12 months historical data?
6. Can you provide the missing 10 July–5 August 2026 data?
7. What does every reject code mean?
8. How is the current product identified?
9. What exactly should "sack stock for each machine" mean?
10. Do you want direct PLC connection or is database connection acceptable?
11. What exactly do you expect from "AI calibration"?
12. Who will use the software and what should each user be allowed to do?
